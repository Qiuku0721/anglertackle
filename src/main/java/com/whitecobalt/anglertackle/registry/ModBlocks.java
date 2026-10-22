package com.whitecobalt.anglertackle.registry;

import com.whitecobalt.anglertackle.AnglersTackle;
import com.whitecobalt.anglertackle.block.FishRackBlock;
import net.minecraft.world.level.block.SoundType;
import net.minecraft.world.level.block.state.BlockBehaviour;
import net.minecraft.world.level.material.MapColor;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.neoforge.registries.DeferredBlock;
import net.neoforged.neoforge.registries.DeferredRegister;

/**
 * 方块注册表。本模组方块很少，都在这里。
 *
 * <p>{@code strength} 取木头一档；{@code noOcclusion} 必须加 ——
 * 鱼架渲染出来的鱼会超出方块体积，剔除掉就会"鱼的身子一半消失"。
 */
public final class ModBlocks {

    public static final DeferredRegister.Blocks BLOCKS =
            DeferredRegister.createBlocks(AnglersTackle.MOD_ID);

    public static final DeferredBlock<FishRackBlock> FISH_RACK = BLOCKS.register("fish_rack",
            () -> new FishRackBlock(BlockBehaviour.Properties.of()
                    .mapColor(MapColor.WOOD)
                    .strength(0.8F)
                    .sound(SoundType.WOOD)
                    .noOcclusion()));

    /**
     * 水族箱：方块本身就是水，壁只在露出的面。
     *
     * <p>{@code noOcclusion} + {@code lightLevel} 都要给：缸壁是薄片，
     * 不透明的话里面会黑成一团，看不见鱼。
     */
    public static final DeferredBlock<com.whitecobalt.anglertackle.block.AquariumBlock> AQUARIUM =
            BLOCKS.register("aquarium", () -> new com.whitecobalt.anglertackle.block.AquariumBlock(
                    BlockBehaviour.Properties.of()
                            .mapColor(MapColor.COLOR_CYAN)
                            .strength(0.6F)
                            .sound(SoundType.GLASS)
                            .noOcclusion()
                            .isViewBlocking((state, level, pos) -> false)
                            .isSuffocating((state, level, pos) -> false)));

    /**
     * 放生台：手持鱼右击，把鱼放回附近的水里（docs/20 §3.5）。
     *
     * <p>和上面两个方块不同，它**不需要** {@code noOcclusion}：整块不透明、
     * 模型就是一个完整的立方体，没有超出方块体积的渲染。找水/生成实体/扣物品
     * 都在 {@code AquariumTank.releaseFromPlatform} 里，所以也没有方块实体。
     */
    public static final DeferredBlock<com.whitecobalt.anglertackle.block.ReleasePlatformBlock> RELEASE_PLATFORM =
            BLOCKS.register("release_platform", () -> new com.whitecobalt.anglertackle.block.ReleasePlatformBlock(
                    BlockBehaviour.Properties.of()
                            .mapColor(MapColor.WOOD)
                            .strength(2.0F)
                            .sound(SoundType.WOOD)));

    /**
     * 冰钓三形态里属于本模组的两个（第三个"浮冰"见 {@link #PACK_ICE}）。
     *
     * <p><b>冰洞</b>：{@code noCollission} 是必须的 —— 浮漂要停在这一格的水面上；
     * 不透明也不行（洞里是水，剔掉面会看不见水）。它**不排回冻调度**（用户定案）。
     *
     * <p><b>碎冰 / 浮冰</b>：都是普通实心方块，靠 {@code scheduleTick} 到点换下一形态
     * （见各自的类注释：为什么不用方块实体、以及为什么浮冰不能用原版 {@code packed_ice}）。
     */
    public static final DeferredBlock<com.whitecobalt.anglertackle.block.IceHoleBlock> ICE_HOLE =
            BLOCKS.register("ice_hole", () -> new com.whitecobalt.anglertackle.block.IceHoleBlock(
                    BlockBehaviour.Properties.of()
                            .mapColor(MapColor.ICE)
                            .strength(0.5F)
                            .sound(SoundType.GLASS)
                            .noCollission()
                            .noOcclusion()
                            .isViewBlocking((state, level, pos) -> false)
                            .isSuffocating((state, level, pos) -> false)));

    public static final DeferredBlock<com.whitecobalt.anglertackle.block.BrokenIceBlock> BROKEN_ICE =
            BLOCKS.register("broken_ice", () -> new com.whitecobalt.anglertackle.block.BrokenIceBlock(
                    BlockBehaviour.Properties.of()
                            .mapColor(MapColor.ICE)
                            .strength(0.5F)
                            .sound(SoundType.GLASS)));

    public static final DeferredBlock<com.whitecobalt.anglertackle.block.PackIceBlock> PACK_ICE =
            BLOCKS.register("pack_ice", () -> new com.whitecobalt.anglertackle.block.PackIceBlock(
                    BlockBehaviour.Properties.of()
                            .mapColor(MapColor.ICE)
                            .strength(0.5F)
                            .sound(SoundType.GLASS)));

    public static void register(IEventBus modBus) {
        BLOCKS.register(modBus);
    }

    private ModBlocks() {
    }
    /** 木板凳（配方 砖砖砖/.棍./棍.棍）。右击坐下，坐着回拉速度 +1%。 */
    public static final DeferredBlock<com.whitecobalt.anglertackle.block.StoolBlock> STOOL =
            BLOCKS.register("stool", () -> new com.whitecobalt.anglertackle.block.StoolBlock(
                    BlockBehaviour.Properties.of()
                            .mapColor(MapColor.WOOD)
                            .strength(0.8F)
                            .sound(SoundType.WOOD)
                            .noOcclusion()));

    /** 带坐垫的木板凳（皮革 + 木板凳）。多 +1% 回拉速度。 */
    public static final DeferredBlock<com.whitecobalt.anglertackle.block.CushionedStoolBlock> CUSHIONED_STOOL =
            BLOCKS.register("cushioned_stool", () -> new com.whitecobalt.anglertackle.block.CushionedStoolBlock(
                    BlockBehaviour.Properties.of()
                            .mapColor(MapColor.COLOR_BROWN)
                            .strength(0.8F)
                            .sound(SoundType.WOOD)
                            .noOcclusion()));

}
