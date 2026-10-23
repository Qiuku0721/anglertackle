package com.whitecobalt.anglertackle.recipe;

import com.whitecobalt.anglertackle.fishing.FishChunkData;
import com.whitecobalt.anglertackle.fishing.FishData;
import com.whitecobalt.anglertackle.item.FishChunkItem;
import com.whitecobalt.anglertackle.registry.ModDataComponents;
import com.whitecobalt.anglertackle.registry.ModItems;
import com.whitecobalt.anglertackle.registry.ModRecipes;
import net.minecraft.core.HolderLookup;
import net.minecraft.core.NonNullList;
import net.minecraft.core.registries.Registries;
import net.minecraft.resources.Identifier;
import net.minecraft.tags.TagKey;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.crafting.CraftingBookCategory;
import net.minecraft.world.item.crafting.CraftingInput;
import net.minecraft.world.item.crafting.CustomRecipe;
import net.minecraft.world.item.crafting.Ingredient;
import net.minecraft.world.item.crafting.RecipeSerializer;
import net.minecraft.world.level.Level;

/**
 * 切块：**一条整鱼 → 三档鱼块**（docs/25 §14.1 的"第 1 级 · 预处理"）。
 *
 * <p>JSON 里只有 {@code type}（匹配与产出全在代码里）—— 因为产出是**动态的**
 * （取决于鱼种、品质、重量），数据驱动的配方表达不了"把输入那条鱼的数据搬到产物上"。
 *
 * <h2>⚠ 但它**不是** special 配方（用户 2026-10-03："内容写进原版配方书"）</h2>
 * 原版 {@code ClientRecipeBook} 只收 {@code !isSpecial() && !isIncomplete()} 的配方，
 * 所以 {@link #isSpecial()} 覆写成 false、{@link #getIngredients()} 给出真材料、
 * {@link #getResultItem} 给出代表产物 —— 三件事缺一条配方书里就看不到这条配方。
 * 解锁进度由 {@code tools/gen-recipe-advancements.js} 生成（材料取
 * {@code #anglertackle:fishes}，与这里的 {@link #getIngredients} 对账的检查器是
 * {@code tools/check-recipe-book.js}）。
 *
 * <h2>两条映射（都在 docs/25 里写死）</h2>
 * <ul>
 *   <li><b>档位按品质</b>（§2.1）：白绿→普通鱼块、蓝紫→优质鱼肉、金红→顶级鱼排。
 *       实现走 {@link FishChunkData#groupOfTier(int)}，**不在这里写第二套 if**。</li>
 *   <li><b>份数按重量</b>（§2.3）：保底 1、上限 12；每块"吃掉"的重量按档位不同 ——
 *       普通块 0.25kg、优质肉 1kg、顶级排 3kg（越好的鱼越"压秤"，一条 30kg 的顶级鱼
 *       出 10 块，而 1kg 的小鲫鱼出 4 块）。</li>
 * </ul>
 *
 * <h2>⚠ 为什么必须覆写 getRemainingItems</h2>
 * 自定义配方不覆写它就什么都不返还（原版那套"剩余物"只对容器类材料自动生效）。
 * 切块这条目前**没有容器材料**，所以返回全空 —— 但**显式写出来**，
 * 免得以后有人往里加"需要返还"的材料（比如鱼刀）时以为它会自动处理。
 */
public class CuttingRecipe extends CustomRecipe {

    /** 每块鱼块"吃掉"的重量（kg），下标 = 材料档位。 */
    private static final float[] KG_PER_CHUNK = {0.25f, 1.0f, 3.0f};
    /** 份数上下限（docs/25 §2.3 用户定：保底 1、上限 12）。 */
    public static final int MIN_CHUNKS = 1;
    public static final int MAX_CHUNKS = 12;

    /**
     * 能切的输入：{@code #anglertackle:fishes} 标签（全部模组鱼）。
     *
     * <p>用标签而不是"逐条列 28 个鱼物品"：加鱼种时不用改这里，而标签本身
     * 由 {@code check-fish-species} 一类的检查器与 {@code ModEntities.FISHES} 对齐。
     */
    private static final TagKey<Item> FISHES = TagKey.create(Registries.ITEM,
            Identifier.fromNamespaceAndPath(com.whitecobalt.anglertackle.AnglersTackle.MOD_ID, "fishes"));

    public CuttingRecipe(CraftingBookCategory category) {
        super(category);
    }

    /**
     * 份数公式：{@code clamp(round(重量 / 每块重量), 1, 12)}。
     *
     * <p>抽成 public static 是为了让检查器能直接拿它复算（`check-cutting.js`），
     * 而不是在检查器里把公式抄一遍 —— 抄一遍就等于自己证明自己。
     */
    public static int chunkCount(float weightKg, int group) {
        float per = KG_PER_CHUNK[Math.max(0, Math.min(KG_PER_CHUNK.length - 1, group))];
        int n = Math.round(weightKg / per);
        return Math.max(MIN_CHUNKS, Math.min(MAX_CHUNKS, n));
    }

    /** 档位 → 生块物品。 */
    public static ItemStack rawChunkOf(int group) {
        return switch (group) {
            case FishChunkData.GROUP_FINE -> new ItemStack(ModItems.FINE_FISH_MEAT.get());
            case FishChunkData.GROUP_SUPREME -> new ItemStack(ModItems.SUPREME_FISH_STEAK.get());
            default -> new ItemStack(ModItems.FISH_CHUNK.get());
        };
    }

    /** 取出那唯一一条有数据的鱼；不满足就返回 null。 */
    private static ItemStack findFish(CraftingInput input) {
        ItemStack fish = null;
        for (int i = 0; i < input.size(); i++) {
            ItemStack s = input.getItem(i);
            if (s.isEmpty()) continue;
            if (fish != null) return null;                    // 只吃一条鱼
            if (!s.is(FISHES)) return null;
            if (s.get(ModDataComponents.FISH_DATA.get()) == null) return null;
            fish = s;
        }
        return fish;
    }

    @Override
    public boolean matches(CraftingInput input, Level level) {
        return findFish(input) != null;
    }

    @Override
    public ItemStack assemble(CraftingInput input, HolderLookup.Provider registries) {
        ItemStack fish = findFish(input);
        if (fish == null) return ItemStack.EMPTY;
        FishData data = fish.get(ModDataComponents.FISH_DATA.get());
        if (data == null) return ItemStack.EMPTY;

        int group = FishChunkData.groupOfTier(data.tier());
        ItemStack out = rawChunkOf(group);
        out.setCount(chunkCount(data.weightKg(), group));
        // 数据一路继承：整鱼 → 生块 → 熟块 → 菜（docs/25 §14.5）
        out.set(ModDataComponents.FISH_CHUNK.get(),
                new FishChunkData(data.speciesId(), data.tier(), data.weightKg()));
        return out;
    }

    @Override
    public NonNullList<ItemStack> getRemainingItems(CraftingInput input) {
        // 显式返回全空：切块目前没有容器材料要返还。
        // ⚠ 以后往这条配方里加"不该被消耗"的材料（鱼刀）时，必须在这里改。
        return NonNullList.withSize(input.size(), ItemStack.EMPTY);
    }

    // ------------------------------------------------------------------ 原版配方书
    // 见类注释：这三件事缺一条，这条配方在配方书里就看不到。

    /** 覆写成 false 才会进配方书（{@link CustomRecipe} 默认是 true）。 */
    @Override
    public boolean isSpecial() {
        return false;
    }

    /** 配方书里要摆一条**整鱼**（{@link #findFish} 认的就是这个标签）。 */
    @Override
    public NonNullList<Ingredient> getIngredients() {
        NonNullList<Ingredient> list = NonNullList.create();
        list.add(Ingredient.of(FISHES));
        return list;
    }

    /**
     * 配方书里那一格画什么：**普通生鱼块**（1 块）。
     *
     * <p>真实份数是按重量算的（1~12 块），配方书一格摆不下也没法表达，
     * 所以这里给个代表值 —— 玩家看到的仍然是"整鱼 → 鱼块"。
     */
    @Override
    public ItemStack getResultItem(HolderLookup.Provider registries) {
        return rawChunkOf(FishChunkData.GROUP_COMMON);
    }

    @Override
    public boolean canCraftInDimensions(int width, int height) {
        return width * height >= 1;      // 随身 2×2 也能切
    }

    @Override
    public RecipeSerializer<?> getSerializer() {
        // ⚠ 必须是 CRAFTING 那条序列化器（见 ModRecipes 的类注释）：
        //   配方进哪张表由 Recipe#getType() 决定，而 CustomRecipe 默认报告 CRAFTING，
        //   所以这里不要覆盖 getType()。
        return ModRecipes.CUTTING.get();
    }
}
