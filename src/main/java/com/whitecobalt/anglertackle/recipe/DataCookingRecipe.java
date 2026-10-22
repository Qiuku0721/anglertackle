package com.whitecobalt.anglertackle.recipe;

import com.whitecobalt.anglertackle.fishing.FishChunkData;
import com.whitecobalt.anglertackle.registry.ModDataComponents;
import net.minecraft.core.HolderLookup;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.crafting.AbstractCookingRecipe;
import net.minecraft.world.item.crafting.CookingBookCategory;
import net.minecraft.world.item.crafting.Ingredient;
import net.minecraft.world.item.crafting.RecipeType;
import net.minecraft.world.item.crafting.SingleRecipeInput;

/**
 * 加热类配方的公共部分：把输入鱼块的 FISH_CHUNK 数据搬到产物上（docs/25 §14.5 数据继承链）。
 *
 * <p>三种设备（熔炉/烟熏炉/营火）共用这一段，差别只在 RecipeType 与产出物品，
 * 所以拆成三个极薄的子类。
 *
 * <h2>三条 API 事实（从 build/moddev/artifacts/neoforge-21.1.252-merged.jar 用 javap 抄的）</h2>
 * <pre>
 *   1) 工厂接口是 AbstractCookingRecipe.Factory（不在 SimpleCookingSerializer 上），
 *      create 有 6 个参数、第一个是 String group
 *   2) AbstractCookingRecipe 构造函数 = (RecipeType, String group, CookingBookCategory,
 *      Ingredient, ItemStack, float, int)
 *   3) 输入栈类型是 SingleRecipeInput（1.21.1 没有 CookingInput）
 * </pre>
 * 前两轮就是少写了 String group 而编译不过：javac 的「需要/找到」两行当时看着自相矛盾，
 * 真正的类型要去 SimpleCookingSerializer 的字段上看。
 */
public abstract class DataCookingRecipe extends AbstractCookingRecipe {

    protected DataCookingRecipe(RecipeType<?> type, String group, CookingBookCategory category,
                                Ingredient ingredient, ItemStack result, float experience, int cookingTime) {
        super(type, group, category, ingredient, result, experience, cookingTime);
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
    public ItemStack assemble(SingleRecipeInput input, HolderLookup.Provider registries) {
        return inheritChunkData(input, super.assemble(input, registries));
    }
}