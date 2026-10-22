package com.whitecobalt.anglertackle.recipe;

import com.whitecobalt.anglertackle.registry.ModRecipes;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.crafting.CookingBookCategory;
import net.minecraft.world.item.crafting.Ingredient;
import net.minecraft.world.item.crafting.RecipeSerializer;
import net.minecraft.world.item.crafting.RecipeType;

/** 熔炉清烤：生鱼块 -> 熟鱼块（三档各一条配方，见 docs/25 §14.4）。 */
public class ChunkSmeltingRecipe extends DataCookingRecipe {

    public ChunkSmeltingRecipe(String group, CookingBookCategory category, Ingredient ingredient,
                               ItemStack result, float experience, int cookingTime) {
        super(RecipeType.SMELTING, group, category, ingredient, result, experience, cookingTime);
    }

    @Override
    public RecipeSerializer<?> getSerializer() {
        return ModRecipes.CHUNK_SMELTING.get();
    }
}