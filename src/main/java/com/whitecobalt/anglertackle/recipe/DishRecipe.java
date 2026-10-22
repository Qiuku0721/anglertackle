package com.whitecobalt.anglertackle.recipe;

import com.whitecobalt.anglertackle.fishing.FishChunkData;
import com.whitecobalt.anglertackle.fishing.FishData;
import com.whitecobalt.anglertackle.fishing.FishSpecies;
import com.whitecobalt.anglertackle.item.FishChunkItem;
import com.whitecobalt.anglertackle.registry.ModDataComponents;
import com.whitecobalt.anglertackle.registry.ModItems;
import com.whitecobalt.anglertackle.registry.ModRecipes;
import com.whitecobalt.anglertackle.registry.ModTags;
import net.minecraft.core.HolderLookup;
import net.minecraft.core.NonNullList;
import net.minecraft.core.component.DataComponents;
import net.minecraft.world.food.FoodProperties;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;
import net.minecraft.tags.TagKey;
import net.minecraft.world.item.crafting.CraftingBookCategory;
import net.minecraft.world.item.crafting.CraftingInput;
import net.minecraft.world.item.crafting.CustomRecipe;
import net.minecraft.world.item.crafting.Ingredient;
import net.minecraft.world.item.crafting.RecipeSerializer;
import net.minecraft.world.level.Level;

import javax.annotation.Nullable;
import java.util.ArrayList;
import java.util.EnumSet;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Predicate;
import java.util.function.Supplier;

/**
 * 第 3 级 · 调味成菜：**熟块 / 生块 / 整鱼 + 配料 → 具体的一道菜**（docs/25 §14.1）。
 *
 * <p>一条配方类覆盖全部菜型，菜型之间的差别全在 {@link Dish} 枚举里（材料表 + 产物）。
 * JSON 里只有 {@code type + category}（匹配与产出全在代码里），因为：
 * <ul>
 *   <li>产物要**带着输入鱼块的鱼种/档位/重量**走（数据驱动的配方做不到）；</li>
 *   <li>要让"水桶返还空桶、鱼刀只扣耐久"这类返还规则可控（见 {@link #getRemainingItems}）。</li>
 * </ul>
 *
 * <h2>⚠ 它**不是** special 配方（用户 2026-10-03："内容写进原版配方书"）</h2>
 * {@link CustomRecipe} 默认 {@code isSpecial() == true}，而原版
 * {@code ClientRecipeBook} 有一句 {@code if (!recipe.isSpecial() && !recipe.isIncomplete())}
 * —— 于是 special 配方**一条都进不了配方书**（玩家只能背配方）。
 * 所以这里三件事一起做，缺一条配方书里就看不到：
 * <ol>
 *   <li>{@link #isSpecial()} 覆写成 {@code false}；</li>
 *   <li>{@link #getIngredients()} 给出**真实材料**（配方书靠它判"做不做得出来"、
 *       也是点一下自动摆料的依据 —— 所以条数必须和 {@link #match} 的消耗一致，
 *       例如鱼丸要两块熟块就出现两条）；</li>
 *   <li>{@link #getResultItem} 给出**代表产物**（不带鱼种数据，配方书只画图标）。
 *       没有它配方书里那一格是空的。</li>
 * </ol>
 * 解锁仍然走原版那套：{@code tools/gen-recipe-advancements.js} 生成的进度
 * （special 配方没有 ingredients，所以那份"解锁材料"表在该生成器里，
 * 由 {@code tools/check-recipe-book.js} 与本文件逐条对账）。
 *
 * <h2>三条规则（docs/25 §14.3）</h2>
 * <ol>
 *   <li>产出物品**按菜型**注册：一件物品一张贴图，鱼种进数据组件；</li>
 *   <li>**不同鱼的同名菜共用这一条配方** —— 鱼块里的数据已经把鱼区分开了；</li>
 *   <li>**同一条鱼的两道菜配料必须不同** —— 由 {@link Dish} 的材料表保证，
 *       而"这条鱼能不能做这道菜"由 {@link #allowedFor} 那张表管（docs/25 §13.5）。</li>
 * </ol>
 *
 * <h2>⚠ 饱食度按档位（docs/25 §5）</h2>
 * 4（普通）/ 6（优质）/ 8（顶级），饱和度分别是 4.0 / 6.0 / 8.0。
 * 实现方式是**在产物栈上写 FOOD 组件**（1.21 允许每栈一份食物属性），
 * 而不是靠 12 个物品各自的注册属性 —— 否则同一道菜的三档就没法区分了。
 */
public class DishRecipe extends CustomRecipe {

    /** 能当"整鱼"用的输入：与切块同一套标签（全部模组鱼）。 */
    private static final net.minecraft.tags.TagKey<Item> FISHES =
            net.minecraft.tags.TagKey.create(net.minecraft.core.registries.Registries.ITEM,
                    net.minecraft.resources.ResourceLocation.fromNamespaceAndPath(
                            com.whitecobalt.anglertackle.AnglersTackle.MOD_ID, "fishes"));

    /** 主料类型。 */
    public enum Base {
        /** 熟块（熔炉清烤过）：绝大多数第 3 级菜的主料。 */
        COOKED,
        /** 生块：只有刺身走生料。 */
        RAW,
        /** 整鱼：横纹鱼 / 白条鱼这类切不出块的小鱼，整条下锅。 */
        WHOLE_FISH;

        /**
         * 配方书 / JEI 里主料显示成什么 —— **这条鱼真能切出来的那些块**。
         *
         * <p>为什么带组件：原版 {@code Ingredient.of(ItemStack…)} 的匹配只看物品 id
         * （{@code Ingredient.ItemValue.test} 是 {@code stack.is(item)}），
         * 但 {@code getItems()} 会原样返回这些栈 —— 于是配方书里那一格 hover 上去
         * 写的就是"大西洋鲑 · 顶级鱼排 · 0.5 kg"，不会再出现"什么鱼都能做这道菜"的错觉。
         *
         * <p>⚠ **档位必须按鱼的档位表算**：用户 2026-10-03 抓到的是
         * "刺身需要大西洋鲑的普通鱼块，但显然普通鱼块不可能被大西洋鲑做出来" ——
         * 第一版这里写死了 tier 0，于是红档鱼（{@code {4,5}}）被显示成普通鱼块。
         * 现在按 {@link FishSpecies#tiers()} 去重后逐个给：
         * 跨档的鱼（如鲻鱼 {@code {1,2}}）会给出"普通块 / 优质肉"两个变体，
         * 而那正是它真能切出来的东西。
         */
        public List<ItemStack> sampleStacks(String species) {
            if (this == WHOLE_FISH) {
                Item fish = net.minecraft.core.registries.BuiltInRegistries.ITEM.get(
                        net.minecraft.resources.ResourceLocation.fromNamespaceAndPath(
                                com.whitecobalt.anglertackle.AnglersTackle.MOD_ID, species));
                return fish == null ? List.of() : List.of(new ItemStack(fish));
            }
            List<ItemStack> out = new ArrayList<>();
            for (int group : DishRecipe.chunkGroups(species)) {
                out.add(DishRecipe.chunkStack(this == COOKED, group, species));
            }
            return out;
        }
    }

    /** 这条鱼**真能切出来**的鱼块档位（0 普通 / 1 优质 / 2 顶级），按它的档位表去重。 */
    public static List<Integer> chunkGroups(String species) {
        FishSpecies sp = FishSpecies.byId(species);
        if (sp == null || sp.tiers().length == 0) return List.of(FishChunkData.GROUP_COMMON);
        java.util.LinkedHashSet<Integer> groups = new java.util.LinkedHashSet<>();
        for (int tier : sp.tiers()) {
            groups.add(FishChunkData.groupOfTier(tier));
        }
        return List.copyOf(groups);
    }

    /**
     * 展示用的档位：这条鱼档位表里**最高**的那一档。
     *
     * <p>与 docs/25 §13.5 的"材料"列一致（那一列写的就是这条鱼的看家档位，
     * 例如草鱼"优质鱼肉"= {@code {1,2}} 的 2）。检查器会逐条比对这一列。
     */
    public static int sampleTier(String species) {
        FishSpecies sp = FishSpecies.byId(species);
        if (sp == null || sp.tiers().length == 0) return 0;
        return sp.tiers()[sp.tiers().length - 1];
    }

    /** 某个档位的生块 / 熟块，带上"这是哪条鱼"的组件（配方书展示用）。 */
    static ItemStack chunkStack(boolean cooked, int group, String species) {
        Item item = switch (group) {
            case FishChunkData.GROUP_FINE -> cooked
                    ? ModItems.FINE_FISH_MEAT_COOKED.get() : ModItems.FINE_FISH_MEAT.get();
            case FishChunkData.GROUP_SUPREME -> cooked
                    ? ModItems.SUPREME_FISH_STEAK_COOKED.get() : ModItems.SUPREME_FISH_STEAK.get();
            default -> cooked ? ModItems.FISH_CHUNK_COOKED.get() : ModItems.FISH_CHUNK.get();
        };
        ItemStack stack = new ItemStack(item);
        stack.set(ModDataComponents.FISH_CHUNK.get(), new FishChunkData(species, sampleTier(species), 0.5f));
        return stack;
    }

    /** 配料种类（决定要不要返还）。 */
    private enum Kind { MATERIAL, WATER, KNIFE }

    /**
     * 一条配料要求。
     *
     * <p>{@code book} 是**配方书里展示用的那个物品**：匹配仍然走 {@code test}
     * （两者都由同一个 {@code Supplier<Item>} 造出来，见下面的 {@code mat/water/knife}）。
     */
    private record Need(Predicate<ItemStack> test, int count, Kind kind, Supplier<Item> book,
                        @Nullable TagKey<Item> tag) {
        Ingredient bookIngredient() { return Ingredient.of(book.get()); }
    }

    private static Need mat(Supplier<Item> item) {
        return new Need(s -> s.is(item.get()), 1, Kind.MATERIAL, item, null);
    }

    /**
     * 配料写在**标签**上而不是写死在物品上（docs/30 §4.1，用户 2026-10-03 定案）。
     *
     * <p>这样别的模组的同类物品只要进标签就能顶替：森罗物语的「油脂」顶我们的鱼油、
     * 国味的「盐」顶我们的盐 —— 我们一行适配代码都不用写。
     *
     * <p>⚠ 匹配用 {@code ItemStack#is(TagKey)}（惰性、运行时查标签），
     * 不在静态初始化里碰注册表 —— 本类是被注册期加载的，碰注册表会踩
     * "Cannot get config value before config is loaded" 那类事故（2026-10-03 踩过）。
     * {@code book} 仍然是**我们自己**的物品：配方书展示与进度解锁都该认我们的东西。
     */
    private static Need mat(TagKey<Item> tag, Supplier<Item> book) {
        return new Need(s -> s.is(tag), 1, Kind.MATERIAL, book, tag);
    }

    private static Need water(Supplier<Item> item) {
        return new Need(s -> s.is(item.get()), 1, Kind.WATER, item, null);
    }
    private static Need knife(Supplier<Item> item) {
        return new Need(s -> s.is(item.get()), 1, Kind.KNIFE, item, null);
    }
    private static Need knife(TagKey<Item> tag, Supplier<Item> book) {
        return new Need(s -> s.is(tag), 1, Kind.KNIFE, book, tag);
    }
    private static final Need WATER_BUCKET = water(() -> Items.WATER_BUCKET);
    private static final Need FISH_KNIFE = knife(ModTags.KITCHEN_KNIFE, () -> ModItems.FISH_KNIFE.get());
    private static final Need SOY = mat(() -> ModItems.SOY_SAUCE.get());
    private static final Need SALT = mat(ModTags.SALT, () -> ModItems.SALT.get());
    private static final Need OIL = mat(ModTags.COOKING_OIL, () -> ModItems.FISH_OIL.get());
    private static final Need SUGAR = mat(() -> Items.SUGAR);
    private static final Need WHEAT = mat(() -> Items.WHEAT);
    private static final Need CANE = mat(() -> Items.SUGAR_CANE);

    /**
     * 菜型表（**10 条**；蒲烧按用户 2026-10-03 的决定不做）。
     *
     * <p>材料写在这里而不是 JSON 里，理由见类注释；`tools/check-dish-recipes.js` 会拿
     * docs/25 §14.4 的配方表逐条比对。
     */
    public enum Dish {
        BRAISED("braised_fish", Base.COOKED, 1, List.of(SOY, SUGAR)),
        STEAMED("steamed_fish", Base.COOKED, 1, List.of(WATER_BUCKET, CANE, SOY)),
        PAN_FRIED("pan_fried_fish", Base.COOKED, 1, List.of(OIL, SALT)),
        FRIED_CHUNK("fried_fish_chunk", Base.COOKED, 1, List.of(OIL, WHEAT)),
        SOUP("fish_soup", Base.COOKED, 1, List.of(WATER_BUCKET)),
        CREAMY("creamy_fish_soup", Base.COOKED, 1, List.of(WATER_BUCKET, OIL)),
        STEW("fish_stew", Base.COOKED, 1, List.of(WATER_BUCKET, CANE)),
        BALL("fish_ball", Base.COOKED, 2, List.of(WHEAT)),
        SASHIMI("sashimi", Base.RAW, 1, List.of(SOY, FISH_KNIFE)),
        DEEP_FRIED("deep_fried_fish", Base.WHOLE_FISH, 1, List.of(OIL, WHEAT));

        private final String id;
        private final Base base;
        private final int baseCount;
        private final List<Need> needs;

        Dish(String id, Base base, int baseCount, List<Need> needs) {
            this.id = id;
            this.base = base;
            this.baseCount = baseCount;
            this.needs = needs;
        }

        public String id() { return id; }
        public Base base() { return base; }
        public int baseCount() { return baseCount; }
        public List<Need> needs() { return needs; }

        /**
         * 这道菜除基础鱼块外还要哪些**物品**（顺序与 {@link #needs()} 一致）。
         *
         * <p>给菜谱界面/悬浮显示用的公开视图：{@code Need} 本身是私有的（它的匹配谓词、
         * 水/刀的种类都是配方内部的事），界面只想知道"要哪些物品、几个"。
         * 让界面去抄一张表就等于给"菜谱写的配料"和"真正收的配料"制造分叉的机会。
         */
        /** 菜型 id → 枚举（找不到返回 null；熏鱼/炭烤鱼不在这个枚举里）。 */
        public static Dish byId(String dishId) {
            for (Dish d : values()) {
                if (d.id.equals(dishId)) return d;
            }
            return null;
        }

        /** 这条配料在标签里有几个可替代物（含它自己）；界面据此显示"可用同类替代"。 */
        public boolean hasSubstitute(int index) {
            if (index < 0 || index >= needs.size()) return false;
            Need n = needs.get(index);
            return n.tag() != null && Ingredient.of(n.tag()).getItems().length > 1;
        }

        /** 这条配料可替代物的显示名（含自己），没有替代时只有一个。 */
        public List<String> substituteNames(int index) {
            if (index < 0 || index >= needs.size()) return List.of();
            Need n = needs.get(index);
            if (n.tag() == null) return List.of(n.book().get().getDescription().getString());
            return java.util.Arrays.stream(Ingredient.of(n.tag()).getItems())
                    .map(st -> st.getHoverName().getString()).toList();
        }

        public List<Item> extraItems() {
            return needs.stream().map((n) -> n.book().get()).toList();
        }
        public boolean usesWater() { return needs.stream().anyMatch(n -> n.kind() == Kind.WATER); }
        public boolean usesKnife() { return needs.stream().anyMatch(n -> n.kind() == Kind.KNIFE); }
    }

    /**
     * **每条鱼允许做哪几道菜**（docs/25 §13.5 的逐鱼菜谱表，23 条食用鱼）。
     *
     * <p>只列**工作台**上的菜；熔炉/烟熏炉/营火那三种是设备配方，不在这张表里
     * （所以巨骨舌鱼在这里是空集：它的两道菜都是设备做的）。
     *
     * <p>⚠ 这张表是"抄"文档的，`tools/check-dish-recipes.js` 会逐条与 docs/25 §13.5 比对 ——
     * 改文档不改这里（或反过来）都会红。
     *
     * <h2>⚠⚠ 为什么必须**懒加载**（1.1.7 的加载崩溃就是这里）</h2>
     * 第一版写成"静态字段 + 静态块"，结果游戏启动直接失败：
     * <pre>
     *   Failed to create mod instance. ModID: anglertackle
     *     at DishRecipe$Dish.&lt;clinit&gt;                      ← 枚举常量要用外层的 SOY 等静态字段
     *     at ModRecipes.buildDishSerializers → ModRecipes.&lt;clinit&gt;
     *     at DishRecipe.allow → DishRecipe.&lt;clinit&gt;        ← 外层静态块又要用枚举常量
     * </pre>
     * 两边互锁：外层类初始化没完就不能碰枚举，枚举初始化没完就不能碰外层静态字段。
     * 改成**内部持有类 + 首次访问才建表**之后，`DishRecipe.&lt;clinit&gt;` 什么都不做，
     * 互锁消失。
     */
    private static final class AllowedTable {
        static final Map<String, Set<Dish>> TABLE = build();
    }

    private static Map<String, Set<Dish>> build() {
        Map<String, Set<Dish>> m = new HashMap<>();
        put(m, "crucian_carp", Dish.SOUP, Dish.CREAMY);            // 鲫鱼：鱼汤 / 奶白鱼汤
        put(m, "tilapia", Dish.PAN_FRIED);                         // 罗非鱼：清烤(设备) / 香煎
        put(m, "grass_carp", Dish.BRAISED, Dish.BALL);             // 草鱼：红烧 / 鱼丸
        put(m, "black_carp", Dish.BRAISED);                        // 青鱼：熏(设备) / 红烧
        put(m, "mirror_carp", Dish.BRAISED);                       // 镜鲤：红烧 / 熏(设备)
        put(m, "topmouth_culter", Dish.STEAMED);                   // 翘嘴：清蒸 / 熏(设备)
        put(m, "zander", Dish.STEAMED, Dish.PAN_FRIED);            // 梭鲈：清蒸 / 香煎
        put(m, "pike", Dish.BALL, Dish.PAN_FRIED);                 // 狗鱼：鱼丸 / 香煎
        put(m, "arapaima");                                        // 巨骨舌鱼：炭烤+熏都是设备
        put(m, "tigerfish", Dish.PAN_FRIED);                       // 虎鱼：炭烤(设备) / 香煎
        put(m, "north_african_catfish", Dish.STEW, Dish.FRIED_CHUNK); // 鲇鱼：炖 / 炸
        put(m, "sapphire_snakehead", Dish.STEW);                   // 雷龙：慢炖 / 清烤(设备)
        put(m, "golden_loach", Dish.STEW, Dish.FRIED_CHUNK);       // 金泥鳅：炖 / 炸
        put(m, "banded_loach", Dish.DEEP_FRIED);                   // 横纹鱼：整条油炸
        put(m, "hemiculter", Dish.DEEP_FRIED);                     // 白条鱼：整条油炸
        put(m, "mullet", Dish.PAN_FRIED, Dish.SOUP);               // 鲻鱼：香煎 / 鱼汤
        put(m, "oxeye_tarpon", Dish.SASHIMI);                      // 大眼海鲢：刺身 / 炭烤(设备)
        put(m, "striped_bass", Dish.STEAMED, Dish.PAN_FRIED);      // 条纹鲈：清蒸 / 香煎
        put(m, "atlantic_salmon", Dish.SASHIMI);                   // 大西洋鲑：刺身（蒲烧已取消）
        put(m, "bluefin_tuna", Dish.SASHIMI);                      // 蓝鳍金枪鱼：刺身 / 炭烤(设备)
        put(m, "juvenile_shark", Dish.PAN_FRIED);                  // 幼鲨：香煎 / 炭烤(设备)
        put(m, "brown_trout", Dish.PAN_FRIED);                     // 褐鳟：香煎 / 炭烤(设备)
        put(m, "platinum_arowana", Dish.STEAMED, Dish.BRAISED);    // 铂金银龙鱼：清蒸 / 红烧

        // ── 第二批 19 条（2026-10-10 补，docs/料理适配策划案.md）────────────────────
        // 依据是**调研里的食用描述**，不是"红鱼就给高数值"：
        // 用户原话"鲯鳅事实上肉质并不好，如果只是因为他是红鱼就给高数值显然不合理"。
        // ⚠ 上面 23 行**一个字都没动**（老存档 / 老配方 / 老进度逐字不变），
        //   这里全是**新增行**；下面的 L5 五条**故意不加进来**（= 不进菜品菜单）。
        // L 等级见 FishPalatability：L0 佳 / L1 普通 / L2 需处理 / L3 难吃 / L4 危险 / L5 非食物。
        put(m, "atlantic_cod", Dish.PAN_FRIED, Dish.FRIED_CHUNK);      // 大西洋鳕 L0：香煎 / 炸块
        put(m, "greenland_halibut", Dish.PAN_FRIED, Dish.STEAMED);     // 格陵兰大比目鱼 L0：香煎 / 清蒸
        put(m, "wolffish", Dish.PAN_FRIED, Dish.SOUP);                 // 狼鱼 L0：香煎 / 鱼汤
        put(m, "sablefish", Dish.BRAISED, Dish.PAN_FRIED);             // 裸盖鱼 L0：红烧银鳕 / 香煎
        put(m, "taimen", Dish.STEAMED, Dish.BRAISED);                  // 哲罗鲑 L0：清蒸 / 红烧
        put(m, "giant_siamese_carp", Dish.STEAMED, Dish.BRAISED);      // 巨暹罗鲤 L0：清蒸 / 红烧
        put(m, "burbot", Dish.SOUP, Dish.PAN_FRIED);                   // 江鳕 L1（偏干）：汤 / 香煎
        put(m, "arctic_cod", Dish.PAN_FRIED, Dish.SOUP);               // 北极鳕 L1：香煎 / 汤
        put(m, "capelin", Dish.DEEP_FRIED);                            // 毛鳞鱼 L1：整条油炸（只有一道）
        put(m, "atlantic_herring", Dish.PAN_FRIED, Dish.FRIED_CHUNK);  // 大西洋鲱 L1：香煎 / 炸块
        put(m, "redfish", Dish.STEAMED, Dish.PAN_FRIED);               // 平鲉 L1：清蒸 / 香煎
        put(m, "rainbow_trout", Dish.PAN_FRIED, Dish.BRAISED);         // 虹鳟 L2：香煎 / 红烧（生食有寄生虫）
        put(m, "arctic_char", Dish.PAN_FRIED, Dish.STEAMED);           // 北极红点鲑 L2：香煎 / 清蒸
        put(m, "whitefish", Dish.STEAMED, Dish.PAN_FRIED);             // 高白鲑 L2：清蒸 / 香煎
        put(m, "mahi_mahi", Dish.SASHIMI, Dish.PAN_FRIED);             // 鲯鳅 L2：刺身 / 香煎（肉质一般 + 雪卡）
        put(m, "alligator_gar", Dish.BALL, Dish.FRIED_CHUNK);          // 鳄雀鳝 L3：鱼丸（须反复刮筋）/ 炸块
        put(m, "greenland_shark", Dish.STEW, Dish.PAN_FRIED);          // 格陵兰鲨 L4：炖 / 香煎（须发酵）
        put(m, "electric_eel", Dish.BRAISED, Dish.STEW);               // 电鳗 L4：红烧 / 炖（须耗电）
        put(m, "sailfish", Dish.PAN_FRIED, Dish.STEW);                 // 雨伞旗鱼 L4：香煎 / 炖（汞富集）
        return m;
    }

    private static void put(Map<String, Set<Dish>> table, String species, Dish... dishes) {
        table.put(species, dishes.length == 0 ? EnumSet.noneOf(Dish.class) : EnumSet.copyOf(List.of(dishes)));
    }

    /** 这条鱼允许做的工作台菜型（没记录 = 空集）。 */
    public static Set<Dish> allowedFor(String species) {
        return AllowedTable.TABLE.getOrDefault(species, Set.of());
    }

    /** 「一条鱼 × 一道菜」= 一条配方。顺序固定（菜型序 → 鱼种名），注册 id 才稳定。 */
    public record Pair(Dish dish, String species) {
        /** 配方 id 与序列化器 id：{@code <菜型>/<鱼种>}，例如 {@code braised_fish/grass_carp}。 */
        public String id() {
            return dish.id() + "/" + species;
        }
    }

    /**
     * 把 §13.5 那张逐鱼许可表**展开成配方清单** —— 这张表就是配方的定义，
     * 配方 JSON（`tools/gen-dish-recipes.js` 生成）与序列化器（{@code ModRecipes}）都从它来，
     * 所以"显示"和"定义"不可能对不上。
     */
    public static List<Pair> allowedPairs() {
        List<Pair> out = new ArrayList<>();
        List<String> species = new ArrayList<>(AllowedTable.TABLE.keySet());
        java.util.Collections.sort(species);
        for (Dish d : Dish.values()) {
            for (String sp : species) {
                if (AllowedTable.TABLE.get(sp).contains(d)) {
                    out.add(new Pair(d, sp));
                }
            }
        }
        return out;
    }

    /**
     * 这道菜在这个**档位**上给多少饱食度（用户 2026-10-03：数值只跟鱼的档位走，
     * 每差一级差半格，且菜至少比熟块高半格 —— 见 {@link FoodValues}）。
     *
     * <p>旧版是按"三个材料档次"分 4/6/8；现在按**六个档位**分 4…9，
     * 三段的低档仍然是 4 / 6 / 8，与设计稿不冲突。
     *
     * @param tier 鱼块（或整鱼）身上的**真实档位** 0…5
     */
    public static FoodProperties foodFor(int tier) {
        return com.whitecobalt.anglertackle.fishing.FoodValues.dish(tier);
    }

    private final Dish dish;
    private final String species;

    public DishRecipe(CraftingBookCategory category, Dish dish, String species) {
        super(category);
        this.dish = dish;
        this.species = species;
    }

    public Dish dish() {
        return dish;
    }

    /**
     * 这条配方是**哪条鱼**的那道菜（docs/25 §13.5 的一行 = 一条配方）。
     *
     * <p>用户 2026-10-03："配方必须完全与定义一致，现在的问题是配方显示模糊，什么鱼都可以做菜。"
     * 所以配方从"一种做法一条"拆成"一条鱼 × 一道菜一条"：JEI / 配方书里看到的是
     * **红烧草鱼**、**红烧青鱼**…而不是笼统的"红烧鱼 + 任意熟块"。
     */
    public String species() {
        return species;
    }

    /** 一次匹配的结果：主料数据 + 各配料的槽位（返还时要用）。 */
    private record Match(FishChunkData data, List<Integer> waterSlots, List<Integer> knifeSlots) {
    }

    /** 主料判定：熟块 / 生块 / 整鱼。 */
    private static boolean isBase(Dish dish, ItemStack s) {
        return switch (dish.base()) {
            case COOKED -> s.getItem() instanceof FishChunkItem c && c.cooked();
            case RAW -> s.getItem() instanceof FishChunkItem c && !c.cooked();
            case WHOLE_FISH -> s.is(FISHES);
        };
    }

    private Match match(CraftingInput input) {
        List<ItemStack> base = new ArrayList<>();
        int baseSlots = 0;
        FishChunkData data = null;
        List<Integer> waters = new ArrayList<>();
        List<Integer> knives = new ArrayList<>();
        List<Need> remaining = new ArrayList<>(dish.needs());
        for (int i = 0; i < input.size(); i++) {
            ItemStack s = input.getItem(i);
            if (s.isEmpty()) continue;
            if (isBase(dish, s)) {
                base.add(s);
                // ⚠ 主料按**格**数，不按**个数**数（用户 2026-10-03：
                //   "往配方栏里塞多个相同物品会导致无法合成，除非换成一个"）。
                //
                // 理由在 ResultSlot#onTake：原版每合成一次，是**每个非空格子各扣 1 个**。
                // 所以匹配必须按格算：
                //   · 一格放一叠熟块（哪怕 8 个）对"1 块"的菜照样匹配 ✓，
                //     扣掉 1 个之后剩下的还在，于是**可以按住 Shift 连续合成**（批量）；
                //   · 反过来若按个数算，"1 块"的菜在放了 2 个时就不匹配了（用户遇到的），
                //     而"2 块"的菜（鱼丸）会变成"一格里放 2 个"也算 —— 那会**白送**：
                //     合成只从这一格里扣 1 个，却能出成品的菜。
                // 所以这里是按格数，而且要求**格子数正好等于**配方的份数。
                baseSlots++;
                if (dish.base() != Base.WHOLE_FISH) {
                    FishChunkData d = s.get(ModDataComponents.FISH_CHUNK.get());
                    if (d == null) return null;
                    if (data == null) {
                        data = d;
                    } else if (!data.speciesId().equals(d.speciesId()) || data.tier() != d.tier()) {
                        return null;                       // 混了两条鱼
                    }
                } else {
                    FishData fd = s.get(ModDataComponents.FISH_DATA.get());
                    if (fd == null) return null;
                    data = new FishChunkData(fd.speciesId(), fd.tier(), fd.weightKg());
                }
                continue;
            }
            // 配料：找到第一个能匹配的未消耗要求
            Need hit = null;
            for (Need need : remaining) {
                if (need.test().test(s)) { hit = need; break; }
            }
            if (hit == null) return null;                  // 多了不该有的东西
            remaining.remove(hit);
            if (hit.kind() == Kind.WATER) waters.add(i);
            if (hit.kind() == Kind.KNIFE) knives.add(i);
        }
        if (data == null || baseSlots != dish.baseCount() || !remaining.isEmpty()) return null;
        // 这条鱼就是这条配方定义的那条鱼（docs/25 §13.5 一行一条配方）
        if (!species.equals(data.speciesId())) return null;
        return new Match(data, waters, knives);
    }

    @Override
    public boolean matches(CraftingInput input, Level level) {
        return match(input) != null;
    }

    @Override
    public ItemStack assemble(CraftingInput input, HolderLookup.Provider registries) {
        Match m = match(input);
        if (m == null) return ItemStack.EMPTY;
        ItemStack stack = new ItemStack(resultItem());
        // 数据继承：这条鱼是谁、什么档位、多重（docs/25 §14.5）
        stack.set(ModDataComponents.FISH_CHUNK.get(), m.data());
        // 饱食度按档位（4/6/8）—— 写在这一栈上，而不是物品注册属性上
        stack.set(DataComponents.FOOD, foodFor(m.data().tier()));
        return stack;
    }

    /**
     * 这道菜对应哪件物品。
     *
     * <p>⚠ 不能写成 {@code Supplier<Item>}：{@code DeferredItem<DishItem>} 与
     * {@code Supplier<Item>} 泛型不协变，直接返回 Item 最省事。
     */
    private Item resultItem() {
        return switch (dish) {
            case BRAISED -> ModItems.BRAISED_FISH.get();
            case STEAMED -> ModItems.STEAMED_FISH.get();
            case PAN_FRIED -> ModItems.PAN_FRIED_FISH.get();
            case FRIED_CHUNK -> ModItems.FRIED_FISH_CHUNK.get();
            case SOUP -> ModItems.FISH_SOUP.get();
            case CREAMY -> ModItems.CREAMY_FISH_SOUP.get();
            case STEW -> ModItems.FISH_STEW.get();
            case BALL -> ModItems.FISH_BALL.get();
            case SASHIMI -> ModItems.SASHIMI.get();
            case DEEP_FRIED -> ModItems.DEEP_FRIED_FISH.get();
        };
    }

    // ------------------------------------------------------------------ 原版配方书
    // 见类注释：这三件事缺一条，这条配方在配方书里就看不到。

    /** 覆写成 false 才会进配方书（{@link CustomRecipe} 默认是 true）。 */
    @Override
    public boolean isSpecial() {
        return false;
    }

    /**
     * 配方书里这条配方要摆哪些材料。
     *
     * <p>**必须和 {@link #match} 的真实消耗逐条对上**：配方书拿它判"做不做得出来"、
     * 玩家点一下也是按它自动摆料（{@code ServerPlaceRecipe}），所以条数错了会
     * "显示能做、点下去做不出来"。这里直接从 {@link Dish} 的 base/baseCount/needs 推，
     * 不另抄一份表。
     *
     * <p>⚠ 主料的条数 = **格子数**（见 {@link #match} 里的注释）：原版每次合成对
     * 每个非空格子各扣 1 个，所以"1 块熟块"是"**一格**里放熟块"，
     * 摆一叠也一样算一格 —— 这也正是能按住 Shift 批量合成的原因。
     */
    @Override
    public NonNullList<Ingredient> getIngredients() {
        NonNullList<Ingredient> list = NonNullList.create();
        List<ItemStack> samples = dish.base().sampleStacks(species);
        Ingredient base;
        if (!samples.isEmpty()) {
            base = Ingredient.of(samples.toArray(new ItemStack[0]));
        } else if (dish.base() == Base.WHOLE_FISH) {
            base = Ingredient.of(FISHES);                 // 兜底：鱼种查不到时用整鱼标签
        } else if (dish.base() == Base.COOKED) {
            base = Ingredient.of(ModItems.FISH_CHUNK_COOKED.get());
        } else {
            base = Ingredient.of(ModItems.FISH_CHUNK.get());
        }
        for (int i = 0; i < dish.baseCount(); i++) {
            list.add(base);
        }
        for (Need n : dish.needs()) {
            list.add(n.bookIngredient());
        }
        return list;
    }

    /**
     * 配方书 / JEI 里那一格画什么：**这条鱼的那道菜**（带鱼种组件 → 名字是"红烧草鱼"）。
     *
     * <p>档位取这条鱼档位表里最高的那一档（= docs/25 §13.5 的"材料"列），
     * 重量给个展示值 —— 真实值要钓上来才知道。
     */
    @Override
    public ItemStack getResultItem(HolderLookup.Provider registries) {
        ItemStack stack = new ItemStack(resultItem());
        stack.set(ModDataComponents.FISH_CHUNK.get(),
                new FishChunkData(species, sampleTier(species), 0.5f));
        return stack;
    }

    /**
     * 配方书里把**同一种做法的不同鱼**折叠成一个按钮（草鱼/青鱼/镜鲤/银龙的红烧）。
     *
     * <p>原版 {@code ClientRecipeBook} 就是按 {@code (分类, group)} 分组的：
     * group 为空 → 每条配方各自一个按钮（44 条会把杂项页塞满），
     * 给了 group → 同一组的变体在一个按钮里翻页选。
     */
    @Override
    public String getGroup() {
        return dish.id();
    }

    /**
     * 返还规则（docs/25 §14.6，用户提醒的那个漏洞）：
     * <ul>
     *   <li>**水桶 → 空桶**（鱼汤 / 奶白汤 / 慢炖 / 清蒸）；</li>
     *   <li>**鱼刀不消耗，只扣 1 点耐久**（刺身）；</li>
     *   <li>其余配料照常消耗。</li>
     * </ul>
     * ⚠ 自定义配方**不覆写这个方法就什么都不返还**（原版那套剩余物只对容器自动生效）。
     */
    @Override
    public NonNullList<ItemStack> getRemainingItems(CraftingInput input) {
        NonNullList<ItemStack> out = NonNullList.withSize(input.size(), ItemStack.EMPTY);
        Match m = match(input);
        if (m == null) return out;
        for (int i : m.waterSlots()) out.set(i, new ItemStack(Items.BUCKET));
        for (int i : m.knifeSlots()) {
            ItemStack knife = input.getItem(i).copy();
            knife.setCount(1);
            if (knife.isDamageableItem()) {
                knife.setDamageValue(knife.getDamageValue() + 1);
                if (knife.getDamageValue() >= knife.getMaxDamage()) continue;   // 用完就没了
            }
            out.set(i, knife);
        }
        return out;
    }

    @Override
    public boolean canCraftInDimensions(int width, int height) {
        return width * height >= Math.max(2, dish.baseCount() + dish.needs().size());
    }

    @Override
    public RecipeSerializer<?> getSerializer() {
        return ModRecipes.DISH.get(dish.id() + "/" + species).get();
    }
}