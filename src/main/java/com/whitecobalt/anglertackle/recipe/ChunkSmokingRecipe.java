package com.whitecobalt.anglertackle.recipe;

import com.whitecobalt.anglertackle.registry.ModRecipes;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.crafting.CookingBookCategory;
import net.minecraft.world.item.crafting.Ingredient;
import net.minecraft.world.item.crafting.RecipeSerializer;
import net.minecraft.world.item.crafting.RecipeType;

/**
 * 烟熏炉熏制：生鱼块 -> 熏鱼（堆叠 64 的干粮，docs/25 §14.2）。
 *
 * <p>三档生块都出同一个 smoked_fish 物品（成品菜按菜型注册），鱼种与档位进数据组件。
 */
public class ChunkSmokingRecipe extends DataCookingRecipe {

    public ChunkSmokingRecipe(String group, CookingBookCategory category, Ingredient ingredient,
                              ItemStack result, float experience, int cookingTime) {
        super(RecipeType.SMOKING, group, category, ingredient, result, experience, cookingTime);
    }

    @Override
    public RecipeSerializer<?> getSerializer() {
        return ModRecipes.CHUNK_SMOKING.get();
    }
}