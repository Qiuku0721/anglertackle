package com.whitecobalt.anglertackle.registry;

import com.whitecobalt.anglertackle.AnglersTackle;
import com.whitecobalt.anglertackle.recipe.ChunkCampfireRecipe;
import com.whitecobalt.anglertackle.recipe.ChunkSmeltingRecipe;
import com.whitecobalt.anglertackle.recipe.ChunkSmokingRecipe;
import com.whitecobalt.anglertackle.recipe.CuttingRecipe;
import com.whitecobalt.anglertackle.recipe.DishRecipe;
import com.whitecobalt.anglertackle.recipe.OilPressingRecipe;
import com.whitecobalt.anglertackle.recipe.RodAssemblyRecipe;
import net.minecraft.core.registries.Registries;
import net.minecraft.world.item.crafting.RecipeSerializer;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.neoforge.registries.DeferredHolder;
import net.neoforged.neoforge.registries.DeferredRegister;

/**
 * 配方序列化器。
 *
 * <p>26.1.2 的 {@code RecipeSerializer} 是一个 record（{@code codec + streamCodec}），
 * 原来的 {@code SimpleCraftingRecipeSerializer} / {@code SimpleCookingSerializer} 已全部删除。
 * 所以这里注册的每一个都是 {@code new RecipeSerializer<>(MAP_CODEC, STREAM_CODEC)}，
 * codec 由各配方类自己给出（例如 {@link CuttingRecipe#MAP_CODEC}）。
 *
 * <h2>⚠ 它注册的是 **RecipeSerializer**，不是 RecipeType</h2>
 * JSON 里的 {@code "type"} 指的是**序列化器**的 id，而配方进哪张表由
 * {@code Recipe#getType()} 决定。原版的工作台与随身合成栏是拿
 * {@code RecipeType.CRAFTING} 去查配方的（{@code getRecipeFor(RecipeType.CRAFTING, …)}），
 * 所以这几条合成配方**必须**报告自己是 CRAFTING —— 这件事由
 * {@code CraftingRecipe#getType()} 的默认实现保证（各配方类没有再覆盖它）。
 *
 * <p>如果哪天有人"顺手"给它建一个自己的 RecipeType，配方会被塞进
 * {@code byType[anglertackle:rod_assembly]}，两个合成栏都不会去找它 ——
 * <b>没有任何报错，就是合不出来</b>。守着这件事的是
 * {@code tools/check-craft-assembly.js}。
 *
 * <h2>⚠ 注册的必须是配方 {@code getSerializer()} 返回的**同一个实例**</h2>
 * {@code Recipe.CODEC} 用 {@code BuiltInRegistries.RECIPE_SERIALIZER.getKey(getSerializer())}
 * 找 id；注册另一个"内容相同"的实例会得到 {@code null}，存档/网络同步直接失败。
 * 所以这里一律注册各配方类的 {@code static final SERIALIZER}。
 */
public final class ModRecipes {

    public static final DeferredRegister<RecipeSerializer<?>> SERIALIZERS =
            DeferredRegister.create(Registries.RECIPE_SERIALIZER, AnglersTackle.MOD_ID);

    /**
     * 装配件（special 配方：匹配规则写在代码里，JSON 里没有 ingredients）。
     *
     * <p>产出物是**动态的**（取决于放进去的是哪根竿、哪件配件），
     * 数据驱动的配方表达不了"把输入那根竿原样复制一份再改装"，
     * 所以仍然标 special（不显示在配方书里，与旧版 {@code CustomRecipe#isSpecial()} 一致）。
     */
    public static final DeferredHolder<RecipeSerializer<?>, RecipeSerializer<RodAssemblyRecipe>> ROD_ASSEMBLY =
            SERIALIZERS.register("rod_assembly", () -> RodAssemblyRecipe.SERIALIZER);

    /**
     * 切块：**一条整鱼 → 三档鱼块**（docs/25 §14.1 第 1 级）。
     *
     * <p>它**不是** special（与旧版一致：{@code isSpecial() → false}），产出动态
     * （鱼种/品质/重量都在产物里，还要按重量算份数），JSON 里只写 {@code type + category}。
     * 匹配规则见 {@link CuttingRecipe}。
     */
    public static final DeferredHolder<RecipeSerializer<?>, RecipeSerializer<CuttingRecipe>> CUTTING =
            SERIALIZERS.register("cutting", () -> CuttingRecipe.SERIALIZER);

    // ------------------------------------------------------------------ 加热三件套（第 2 级）
    // 熔炉清烤 / 烟熏炉熏制 / 营火炭烤 —— 都用原版 cookingMapCodec 的字段
    // （category/ingredient/result/experience/cookingtime，外加可选的 show_notification），
    // 但配方类覆写了 assemble：**把输入鱼块的鱼种/档位/重量搬到产物上**（docs/25 §14.5）。
    // 不覆写的话烤完就丢了鱼种，后面所有菜都变成"没有名字的鱼"。

    /** 熔炉清烤（默认 200 刻）。 */
    public static final DeferredHolder<RecipeSerializer<?>, RecipeSerializer<ChunkSmeltingRecipe>> CHUNK_SMELTING =
            SERIALIZERS.register("chunk_smelting", () -> ChunkSmeltingRecipe.SERIALIZER);

    /** 烟熏炉熏制（默认 100 刻，同原版烟熏炉）。 */
    public static final DeferredHolder<RecipeSerializer<?>, RecipeSerializer<ChunkSmokingRecipe>> CHUNK_SMOKING =
            SERIALIZERS.register("chunk_smoking", () -> ChunkSmokingRecipe.SERIALIZER);

    /** 营火炭烤（默认 600 刻，同原版营火）。 */
    public static final DeferredHolder<RecipeSerializer<?>, RecipeSerializer<net.minecraft.world.item.crafting.CampfireCookingRecipe>> CHUNK_CAMPFIRE =
            SERIALIZERS.register("chunk_campfire", () -> ChunkCampfireRecipe.SERIALIZER);

    /**
     * 榨油（special 配方）：**鱼块 → 鱼油**（docs/25 §13.4）。
     *
     * <p>多脂鱼 1 块榨 1 瓶、普通鱼 2 块榨 1 瓶 —— 要读鱼块里的鱼种才知道是哪一种，
     * 所以同样是 special。名单见
     * {@link OilPressingRecipe#OILY_SPECIES}。
     */
    public static final DeferredHolder<RecipeSerializer<?>, RecipeSerializer<OilPressingRecipe>> OIL_PRESSING =
            SERIALIZERS.register("oil_pressing", () -> OilPressingRecipe.SERIALIZER);

    // ------------------------------------------------------------------ 第 3 级：一条鱼 × 一道菜 = 一条配方
    /**
     * 配方 id → 序列化器。**一条配方类覆盖全部菜型**（差别在 DishRecipe 的 Dish 枚举里），
     * 这里按「菜型/鱼种」各注册一个 id，JSON 只写 type + category。
     *
     * <p>用户 2026-10-03："配方必须完全与定义一致，现在的问题是配方显示模糊，什么鱼都可以做菜。"
     * —— 所以 id 从 {@code braised_fish} 变成 {@code braised_fish/grass_carp}：
     * 配方清单**由 {@link DishRecipe#allowedPairs()} 展开**，
     * 也就是 docs/25 §13.5 那张逐鱼表本身。JSON 是 `tools/gen-dish-recipes.js` 从同一张表生成的，
     * 检查器再逐字节比对 —— 显示、配方、定义三者不可能对不上。
     *
     * <p>⚠ 蒲烧（kabayaki）按用户 2026-10-03 的决定**不做**。
     */
    public static final java.util.Map<String, DeferredHolder<RecipeSerializer<?>, RecipeSerializer<DishRecipe>>> DISH =
            buildDishSerializers();

    private static java.util.Map<String, DeferredHolder<RecipeSerializer<?>, RecipeSerializer<DishRecipe>>>
            buildDishSerializers() {
        java.util.Map<String, DeferredHolder<RecipeSerializer<?>, RecipeSerializer<DishRecipe>>> map =
                new java.util.LinkedHashMap<>();
        for (DishRecipe.Pair pair : DishRecipe.allowedPairs()) {
            map.put(pair.id(), SERIALIZERS.register(pair.id(), () -> new RecipeSerializer<>(
                    DishRecipe.mapCodec(pair.dish(), pair.species()),
                    DishRecipe.streamCodec(pair.dish(), pair.species()))));
        }
        return map;
    }

    private ModRecipes() {
    }

    public static void register(IEventBus modBus) {
        SERIALIZERS.register(modBus);
    }
}
