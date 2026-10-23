package com.whitecobalt.anglertackle.recipe;

import com.mojang.serialization.MapCodec;
import net.minecraft.network.RegistryFriendlyByteBuf;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStackTemplate;
import net.minecraft.world.item.Items;
import net.minecraft.world.item.crafting.AbstractCookingRecipe;
import net.minecraft.world.item.crafting.CookingBookCategory;
import net.minecraft.world.item.crafting.Ingredient;
import net.minecraft.world.item.crafting.Recipe;
import net.minecraft.world.item.crafting.RecipeBookCategories;
import net.minecraft.world.item.crafting.RecipeBookCategory;
import net.minecraft.world.item.crafting.RecipeSerializer;
import net.minecraft.world.item.crafting.RecipeType;

/**
 * 烟熏炉熏制：生鱼块 -> 熏鱼（堆叠 64 的干粮，docs/25 §14.2）。
 *
 * <p>三档生块都出同一个 smoked_fish 物品（成品菜按菜型注册），鱼种与档位进数据组件。
 */
public class ChunkSmokingRecipe extends DataCookingRecipe {

    public static final MapCodec<ChunkSmokingRecipe> MAP_CODEC =
            cookingMapCodec(ChunkSmokingRecipe::new, 100);
    public static final StreamCodec<RegistryFriendlyByteBuf, ChunkSmokingRecipe> STREAM_CODEC =
            cookingStreamCodec(ChunkSmokingRecipe::new);
    public static final RecipeSerializer<ChunkSmokingRecipe> SERIALIZER =
            new RecipeSerializer<>(MAP_CODEC, STREAM_CODEC);

    public ChunkSmokingRecipe(Recipe.CommonInfo commonInfo,
                              AbstractCookingRecipe.CookingBookInfo bookInfo,
                              Ingredient ingredient, ItemStackTemplate result,
                              float experience, int cookingTime) {
        super(commonInfo, bookInfo, ingredient, result, experience, cookingTime);
    }

    @Override
    protected Item furnaceIcon() {
        return Items.SMOKER;
    }

    @Override
    public RecipeType<? extends AbstractCookingRecipe> getType() {
        return RecipeType.SMOKING;
    }

    @Override
    public RecipeBookCategory recipeBookCategory() {
        return RecipeBookCategories.SMOKER_FOOD;
    }

    @Override
    public RecipeSerializer<ChunkSmokingRecipe> getSerializer() {
        return SERIALIZER;
    }
}
