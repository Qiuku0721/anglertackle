package com.whitecobalt.anglertackle.recipe;

import com.mojang.serialization.MapCodec;
import net.minecraft.network.RegistryFriendlyByteBuf;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.ItemStackTemplate;
import net.minecraft.world.item.crafting.AbstractCookingRecipe;
import net.minecraft.world.item.crafting.CampfireCookingRecipe;
import net.minecraft.world.item.crafting.CookingBookCategory;
import net.minecraft.world.item.crafting.Ingredient;
import net.minecraft.world.item.crafting.Recipe;
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
 * 父类构造函数已经固定了 {@code RecipeType.CAMPFIRE_COOKING}（26.1.2 里
 * 类型由 {@code getType()} 返回，父类实现仍返回 CAMPFIRE_COOKING）。
 */
public class ChunkCampfireRecipe extends CampfireCookingRecipe {

    public static final MapCodec<ChunkCampfireRecipe> MAP_CODEC =
            cookingMapCodec(ChunkCampfireRecipe::new, 600);
    public static final StreamCodec<RegistryFriendlyByteBuf, ChunkCampfireRecipe> STREAM_CODEC =
            cookingStreamCodec(ChunkCampfireRecipe::new);
    /**
     * ⚠ 类型必须是 {@code RecipeSerializer<CampfireCookingRecipe>}：
     * 26.1.2 的 {@code CampfireCookingRecipe#getSerializer()} 把返回类型收窄成了
     * 具体的 {@code RecipeSerializer<CampfireCookingRecipe>}，子类不能换成另一个
     * 泛型实参（{@code RecipeSerializer<ChunkCampfireRecipe>} 不是它的子类型）。
     * codec 解码出来的实际对象仍然是 {@link ChunkCampfireRecipe}，所以行为不变。
     */
    public static final RecipeSerializer<CampfireCookingRecipe> SERIALIZER =
            new RecipeSerializer<>(
                    MAP_CODEC.xmap(r -> r, r -> (ChunkCampfireRecipe) r),
                    STREAM_CODEC.map(r -> r, r -> (ChunkCampfireRecipe) r));

    public ChunkCampfireRecipe(Recipe.CommonInfo commonInfo,
                               AbstractCookingRecipe.CookingBookInfo bookInfo,
                               Ingredient ingredient, ItemStackTemplate result,
                               float experience, int cookingTime) {
        super(commonInfo, bookInfo, ingredient, result, experience, cookingTime);
    }

    /** 数据继承链：生块 → 炭烤块（docs/25 §14.5），与熔炉 / 烟熏炉同一段逻辑。 */
    @Override
    public ItemStack assemble(SingleRecipeInput input) {
        return DataCookingRecipe.inheritChunkData(input, super.assemble(input));
    }

    @Override
    public RecipeSerializer<CampfireCookingRecipe> getSerializer() {
        return SERIALIZER;
    }
}
