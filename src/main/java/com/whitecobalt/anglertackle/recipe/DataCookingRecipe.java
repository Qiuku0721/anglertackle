package com.whitecobalt.anglertackle.recipe;

import com.whitecobalt.anglertackle.fishing.FishChunkData;
import com.whitecobalt.anglertackle.registry.ModDataComponents;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.ItemStackTemplate;
import net.minecraft.world.item.crafting.AbstractCookingRecipe;
import net.minecraft.world.item.crafting.CookingBookCategory;
import net.minecraft.world.item.crafting.Ingredient;
import net.minecraft.world.item.crafting.Recipe;
import net.minecraft.world.item.crafting.SingleRecipeInput;

/**
 * 加热类配方的公共部分：把输入鱼块的 FISH_CHUNK 数据搬到产物上（docs/25 §14.5 数据继承链）。
 *
 * <p>三种设备（熔炉/烟熏炉/营火）共用这一段，差别只在 RecipeType 与产出物品，
 * 所以拆成三个极薄的子类。
 *
 * <h2>26.1.2 的 API 事实（build/refs/mc2612-src）</h2>
 * <pre>
 *   1) AbstractCookingRecipe 构造函数 = (Recipe.CommonInfo, CookingBookInfo,
 *      Ingredient, ItemStackTemplate, float, int)
 *      —— 不再收 RecipeType / String group，group 在 CookingBookInfo 里；
 *   2) RecipeType 不再由配方字段决定：getType() 由每个具体类返回
 *      （SMELTING / SMOKING / CAMPFIRE_COOKING）；
 *   3) 输入栈类型仍是 SingleRecipeInput，但 assemble 只收一个参数
 *      （Recipe.assemble(T) 不再收 HolderLookup.Provider）；
 *   4) 产物从 ItemStack 变成 ItemStackTemplate（JSON 的 result 字段结构不变，
 *      仍是 {id, count?, components?}，见 ItemStackTemplate.CODEC）。
 * </pre>
 */
public abstract class DataCookingRecipe extends AbstractCookingRecipe {

    protected DataCookingRecipe(Recipe.CommonInfo commonInfo,
                                AbstractCookingRecipe.CookingBookInfo bookInfo,
                                Ingredient ingredient, ItemStackTemplate result,
                                float experience, int cookingTime) {
        super(commonInfo, bookInfo, ingredient, result, experience, cookingTime);
    }

    /**
     * 数据继承：把输入鱼块的 FISH_CHUNK 搬到产物上，**并按档位写饱食度**。
     *
     * <p>抽成 static 是因为**营火那条不能继承这个类**（JEI 会强转成原版
     * {@code CampfireCookingRecipe}，见 {@code ChunkCampfireRecipe} 的类注释），
     * 但它要的是同一段逻辑 —— 复制粘贴两遍迟早会漂移。
     *
     * <p>⚠ 饱食度必须在这里写：熟鱼块/熏鱼/炭烤鱼是**同一件物品**，
     * 注册属性只能给一个固定兜底值，而用户要求"根据鱼品质做区分"
     * （见 {@link FoodValues}）。产物是熟块就按熟块算，是成品菜（熏鱼/炭烤鱼）就按菜算。
     */
    static ItemStack inheritChunkData(SingleRecipeInput input, ItemStack result) {
        ItemStack out = result.copy();
        if (out.isEmpty()) {
            return out;
        }
        FishChunkData data = input.getItem(0).get(ModDataComponents.FISH_CHUNK.get());
        if (data != null) {
            out.set(ModDataComponents.FISH_CHUNK.get(), data);
            out.set(net.minecraft.core.component.DataComponents.FOOD,
                    out.getItem() instanceof com.whitecobalt.anglertackle.item.FishChunkItem
                            ? com.whitecobalt.anglertackle.fishing.FoodValues.cooked(data.tier())
                            : com.whitecobalt.anglertackle.fishing.FoodValues.dish(data.tier()));
        }
        return out;
    }

    @Override
    public ItemStack assemble(SingleRecipeInput input) {
        return inheritChunkData(input, super.assemble(input));
    }
}
