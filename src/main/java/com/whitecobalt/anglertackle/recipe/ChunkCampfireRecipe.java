package com.whitecobalt.anglertackle.recipe;

import com.whitecobalt.anglertackle.registry.ModRecipes;
import net.minecraft.core.HolderLookup;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.crafting.CampfireCookingRecipe;
import net.minecraft.world.item.crafting.CookingBookCategory;
import net.minecraft.world.item.crafting.Ingredient;
import net.minecraft.world.item.crafting.RecipeSerializer;
import net.minecraft.world.item.crafting.SingleRecipeInput;

/**
 * 营火炭烤：生鱼块 -> 炭烤鱼（野外现场做，docs/25 §14.2）。
 *
 * <h2>⚠ 为什么必须继承**原版** {@link CampfireCookingRecipe}（2026-10-03 实机踩到）</h2>
 * 第一版是 {@code extends DataCookingRecipe}（自己传 {@code RecipeType.CAMPFIRE_COOKING}），
 * 逻辑上完全正确，但 **JEI 的营火分类里有一句写死的强转**：
 * <pre>
 *   CampfireCookingCategory.setRecipe(...) {
 *       CampfireCookingRecipe recipe = (CampfireCookingRecipe) holder.value();   // ← ClassCastException
 * </pre>
 * 结果三条营火配方在 JEI 里全部变成 "Found a broken recipe"（日志里明明白白，
 * 游戏里只表现为"这几条配方查不到、点开是空的"）。熔炉 / 烟熏炉那两条用的是
 * {@code AbstractCookingRecipe}，没有这个强转，所以只有营火这一条会炸。
 *
 * <p>所以改成继承原版类，**只有数据继承那一段自己写**（{@link #assemble}）——
 * 父类构造函数已经固定了 {@code RecipeType.CAMPFIRE_COOKING}。
 */
public class ChunkCampfireRecipe extends CampfireCookingRecipe {

    public ChunkCampfireRecipe(String group, CookingBookCategory category, Ingredient ingredient,
                               ItemStack result, float experience, int cookingTime) {
        super(group, category, ingredient, result, experience, cookingTime);
    }

    /** 数据继承链：生块 → 炭烤块（docs/25 §14.5），与熔炉 / 烟熏炉同一段逻辑。 */
    @Override
    public ItemStack assemble(SingleRecipeInput input, HolderLookup.Provider registries) {
        return DataCookingRecipe.inheritChunkData(input, super.assemble(input, registries));
    }

    @Override
    public RecipeSerializer<?> getSerializer() {
        return ModRecipes.CHUNK_CAMPFIRE.get();
    }
}