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
 * 熔炉清烤：生鱼块 -> 熟鱼块（三档各一条配方，见 docs/25 §14.4）。
 *
 * <p>26.1.2 的 {@code RecipeSerializer} 是一个 record（{@code codec + streamCodec}），
 * 原来的 {@code SimpleCookingSerializer} 已删除 —— 所以这里直接用
 * {@link AbstractCookingRecipe#cookingMapCodec} / {@code cookingStreamCodec} 建自己的。
 * JSON 结构与原版熔炉一致（category/ingredient/result/experience/cookingtime）。
 */
public class ChunkSmeltingRecipe extends DataCookingRecipe {

    public static final MapCodec<ChunkSmeltingRecipe> MAP_CODEC =
            cookingMapCodec(ChunkSmeltingRecipe::new, 200);
    public static final StreamCodec<RegistryFriendlyByteBuf, ChunkSmeltingRecipe> STREAM_CODEC =
            cookingStreamCodec(ChunkSmeltingRecipe::new);
    public static final RecipeSerializer<ChunkSmeltingRecipe> SERIALIZER =
            new RecipeSerializer<>(MAP_CODEC, STREAM_CODEC);

    public ChunkSmeltingRecipe(Recipe.CommonInfo commonInfo,
                               AbstractCookingRecipe.CookingBookInfo bookInfo,
                               Ingredient ingredient, ItemStackTemplate result,
                               float experience, int cookingTime) {
        super(commonInfo, bookInfo, ingredient, result, experience, cookingTime);
    }

    @Override
    protected Item furnaceIcon() {
        return Items.FURNACE;
    }

    @Override
    public RecipeType<? extends AbstractCookingRecipe> getType() {
        return RecipeType.SMELTING;
    }

    @Override
    public RecipeBookCategory recipeBookCategory() {
        return switch (category()) {
            case FOOD -> RecipeBookCategories.FURNACE_FOOD;
            case BLOCKS -> RecipeBookCategories.FURNACE_BLOCKS;
            case MISC -> RecipeBookCategories.FURNACE_MISC;
        };
    }

    @Override
    public RecipeSerializer<ChunkSmeltingRecipe> getSerializer() {
        return SERIALIZER;
    }
}
