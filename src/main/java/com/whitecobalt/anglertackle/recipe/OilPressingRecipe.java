package com.whitecobalt.anglertackle.recipe;

import com.whitecobalt.anglertackle.fishing.FishChunkData;
import com.whitecobalt.anglertackle.registry.ModDataComponents;
import com.whitecobalt.anglertackle.registry.ModItems;
import com.whitecobalt.anglertackle.registry.ModRecipes;
import net.minecraft.core.HolderLookup;
import net.minecraft.core.NonNullList;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.crafting.CraftingBookCategory;
import net.minecraft.world.item.crafting.CraftingInput;
import net.minecraft.world.item.crafting.CustomRecipe;
import net.minecraft.world.item.crafting.Ingredient;
import net.minecraft.world.item.crafting.RecipeSerializer;
import net.minecraft.world.level.Level;

import java.util.Set;

/**
 * 榨油：**鱼块 → 鱼油**（docs/25 §13.4，用户 2026-10-03 指定）。
 *
 * <p>规则（用户定的）：**多脂鱼 1 块榨 1 瓶，普通鱼 2 块榨 1 瓶**。
 * 鱼油取代了原方案里"向日葵 + 玻璃瓶做植物油"那套，是香煎 / 油炸 / 奶白汤的必需材料。
 *
 * <p>JSON 里只有 {@code type}：要读鱼块里的 {@link FishChunkData} 才知道"这是不是多脂鱼"，
 * 数据驱动的配方做不到。
 *
 * <h2>⚠ 但它**不是** special 配方（用户 2026-10-03："内容写进原版配方书"）</h2>
 * 原版 {@code ClientRecipeBook} 只收 {@code !isSpecial() && !isIncomplete()} 的配方。
 * 所以 {@link #isSpecial()} 覆写成 false、{@link #getIngredients()} 给出**普通鱼的 2 块**
 * （多脂鱼只要 1 块，配方书表达不了"两种都行"，就按多数情况显示 —— 玩家按 2 块准备一定没错）、
 * {@link #getResultItem} 给出鱼油。解锁进度见 {@code tools/gen-recipe-advancements.js}。
 *
 * <h2>⚠ 多脂鱼名单</h2>
 * 这 5 条写在下面的 {@link #OILY_SPECIES} 里（docs/25 §13.4 + 现实依据 §13.1）：
 * 鲻鱼 / 大西洋鲑 / 蓝鳍金枪鱼 / 幼鲨 / 褐鳟。
 * 检查器 `check-oil-recipe.js` 会拿它跟文档里的名单逐条比对 —— 改了一边不改另一边就红。
 */
public class OilPressingRecipe extends CustomRecipe {

    /** 多脂鱼（1 块就能榨出油）。 */
    public static final Set<String> OILY_SPECIES = Set.of(
            "mullet",              // 鲻鱼
            "atlantic_salmon",     // 大西洋鲑
            "bluefin_tuna",        // 蓝鳍金枪鱼
            "juvenile_shark",      // 幼鲨
            "brown_trout"          // 褐鳟
    );

    /** 普通鱼需要的块数。 */
    public static final int LEAN_CHUNKS = 2;
    /** 多脂鱼需要的块数。 */
    public static final int OILY_CHUNKS = 1;

    public OilPressingRecipe(CraftingBookCategory category) {
        super(category);
    }

    /** 这条鱼要几块才能榨一瓶油。 */
    public static int chunksNeeded(String speciesId) {
        return OILY_SPECIES.contains(speciesId) ? OILY_CHUNKS : LEAN_CHUNKS;
    }

    /**
     * 找齐所有鱼块并校验它们**同种同档**；返回第一条的数据，不合法返回 null。
     *
     * <p>为什么要求同种：一锅油榨的是同一条鱼（否则"两条不同的鱼凑一瓶油"说不通，
     * 而且玩家会为了省材料故意混着放）。
     */
    private static FishChunkData gather(CraftingInput input) {
        FishChunkData first = null;
        int n = 0;
        for (int i = 0; i < input.size(); i++) {
            ItemStack s = input.getItem(i);
            if (s.isEmpty()) continue;
            if (!(s.getItem() instanceof com.whitecobalt.anglertackle.item.FishChunkItem chunk)) return null;
            if (chunk.cooked()) return null;                 // 熟的不榨油
            FishChunkData d = s.get(ModDataComponents.FISH_CHUNK.get());
            if (d == null) return null;
            if (first == null) {
                first = d;
            } else if (!first.speciesId().equals(d.speciesId()) || first.tier() != d.tier()) {
                return null;                                  // 混了别的鱼/别的档位
            }
            n += s.getCount();
        }
        if (first == null) return null;
        return n >= chunksNeeded(first.speciesId()) ? first : null;
    }

    @Override
    public boolean matches(CraftingInput input, Level level) {
        return gather(input) != null;
    }

    @Override
    public ItemStack assemble(CraftingInput input, HolderLookup.Provider registries) {
        return gather(input) == null ? ItemStack.EMPTY : new ItemStack(ModItems.FISH_OIL.get());
    }

    @Override
    public NonNullList<ItemStack> getRemainingItems(CraftingInput input) {
        // 榨油没有容器材料要返还（鱼油是直接产出的瓶子）。
        return NonNullList.withSize(input.size(), ItemStack.EMPTY);
    }

    // ------------------------------------------------------------------ 原版配方书
    // 见类注释：这三件事缺一条，这条配方在配方书里就看不到。

    /** 覆写成 false 才会进配方书（{@link CustomRecipe} 默认是 true）。 */
    @Override
    public boolean isSpecial() {
        return false;
    }

    /**
     * 配方书里要摆**两块生鱼块**（普通鱼的情况）。
     *
     * <p>多脂鱼只要 1 块 —— 但一条配方只能给出一份材料表，按多的那份写，
     * 玩家照它准备一定够。三档生块都行（与 {@link #gather} 一致）。
     */
    @Override
    public NonNullList<Ingredient> getIngredients() {
        NonNullList<Ingredient> list = NonNullList.create();
        Ingredient raw = Ingredient.of(ModItems.FISH_CHUNK.get(),
                ModItems.FINE_FISH_MEAT.get(), ModItems.SUPREME_FISH_STEAK.get());
        for (int i = 0; i < LEAN_CHUNKS; i++) {
            list.add(raw);
        }
        return list;
    }

    /** 配方书里那一格：鱼油一瓶。 */
    @Override
    public ItemStack getResultItem(HolderLookup.Provider registries) {
        return new ItemStack(ModItems.FISH_OIL.get());
    }

    @Override
    public boolean canCraftInDimensions(int width, int height) {
        return width * height >= 1;      // 随身 2×2 也能榨
    }

    @Override
    public RecipeSerializer<?> getSerializer() {
        return ModRecipes.OIL_PRESSING.get();
    }
}
