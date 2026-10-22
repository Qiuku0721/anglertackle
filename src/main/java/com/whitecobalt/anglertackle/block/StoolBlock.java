package com.whitecobalt.anglertackle.block;

import com.mojang.serialization.MapCodec;
import com.whitecobalt.anglertackle.entity.SeatEntity;
import net.minecraft.core.BlockPos;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.InteractionResult;
import net.minecraft.world.ItemInteractionResult;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.level.Level;
import net.minecraft.world.item.DyeColor;
import net.minecraft.world.item.ItemStack;
import net.minecraft.core.Direction;
import net.minecraft.world.item.context.BlockPlaceContext;
import net.minecraft.world.level.BlockGetter;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.phys.shapes.CollisionContext;
import net.minecraft.world.phys.shapes.Shapes;
import net.minecraft.world.phys.shapes.VoxelShape;
import net.minecraft.world.level.block.state.StateDefinition;
import net.minecraft.world.level.block.state.properties.BlockStateProperties;
import net.minecraft.world.level.block.state.properties.DirectionProperty;
import net.minecraft.world.level.block.WoolCarpetBlock;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.phys.BlockHitResult;

/**
 * 木板凳：右击坐下（用户 2026-10-09："做一个椅子功能可以让玩家坐着"）。
 *
 * <p><b>不带方块实体</b>：坐姿由 {@link SeatEntity} 承载 —— 只有实体能被原版
 * {@code startRiding} 骑乘。方块这边只负责"被右击了 → 放一个座位"，
 * 不留任何需要存档的状态 ✓（和 {@link ReleasePlatformBlock} 同一个思路）。
 *
 * <p>配方：`砖砖砖 / .棍. / 棍.棍` ⇒ 木板凳 ✓；皮革 + 木板凳 ⇒ 带坐垫版 ✓
 * （带坐垫的版本多 +1% 回拉速度，见 {@code CushionedStoolBlock}）。
 */
public class StoolBlock extends Block {

    public static final MapCodec<StoolBlock> CODEC = simpleCodec(StoolBlock::new);

    /** 朝向（照森罗厨娘凳：放置时朝着玩家，四向可转）。凳子本身左右对称，但朝向让玩家能"摆正"它 ✓ */
    public static final DirectionProperty FACING = BlockStateProperties.HORIZONTAL_FACING;

    public StoolBlock(Properties properties) {
        super(properties);
    }

    @Override
    protected MapCodec<? extends StoolBlock> codec() {
        return CODEC;
    }

    /** 坐着时额外给多少回拉速度（带坐垫的版本覆盖成更高值）。 */
    public double reelBonus() {
        return 0.01;
    }

    /**
     * 手里拿**染色羊毛地毯**右击**带坐垫的板凳** ⇒ 换成该颜色，**消耗一张地毯** ✓
     * （用户 2026-10-09："消耗" / "开搞"；实机反馈"拿地毯右键反而坐上去"✗ ——
     *   根因是这个方法当时没写进文件，不是设计问题 ✓）。
     * 空手右击仍然坐下（走 useWithoutItem）✓；**普通木板凳不响应地毯** ✓
     * （用户："我只对坐垫凳使用了这个操作"—— 要让普通凳也吃地毯，得先给它一套
     *   不同的外观，例如格子布 vs 纯色布，那是另一次改动 ✓）。
     */
    @Override
    protected ItemInteractionResult useItemOn(ItemStack stack, BlockState state, Level level,
                                              BlockPos pos, Player player, InteractionHand hand,
                                              net.minecraft.world.phys.BlockHitResult hit) {
        if (!state.hasProperty(CushionedStoolBlock.COLOR)) {
            return ItemInteractionResult.PASS_TO_DEFAULT_BLOCK_INTERACTION;   // 普通凳：不响应 ✓
        }
        if (!(stack.getItem() instanceof net.minecraft.world.item.BlockItem bi)
                || !(bi.getBlock() instanceof WoolCarpetBlock carpet)) {
            return ItemInteractionResult.PASS_TO_DEFAULT_BLOCK_INTERACTION;
        }
        DyeColor dye = carpet.getColor();
        if (state.getValue(CushionedStoolBlock.COLOR) == dye) {
            return ItemInteractionResult.PASS_TO_DEFAULT_BLOCK_INTERACTION;   // 已是该色，不浪费 ✓
        }
        if (!level.isClientSide) {
            level.setBlock(pos, state.setValue(CushionedStoolBlock.COLOR, dye), Block.UPDATE_ALL);
            if (!player.hasInfiniteMaterials()) stack.shrink(1);
        }
        return ItemInteractionResult.sidedSuccess(level.isClientSide);
    }

    @Override
    protected void createBlockStateDefinition(StateDefinition.Builder<Block, BlockState> builder) {
        builder.add(FACING);
    }

    @Override
    public BlockState getStateForPlacement(BlockPlaceContext ctx) {
        return defaultBlockState().setValue(FACING, ctx.getHorizontalDirection().getOpposite());
    }
    @Override
    protected InteractionResult useWithoutItem(BlockState state, Level level, BlockPos pos,
                                               Player player, BlockHitResult hit) {
        if (player.isShiftKeyDown()) return InteractionResult.PASS;   // 潜行右击 = 不放座位
        if (SeatEntity.sit(level, pos, player)) return InteractionResult.sidedSuccess(level.isClientSide);
        return InteractionResult.PASS;
    }
    /**
     * 碰撞/轮廓形状 = **半格高的小台子**（凳面顶在 8/16 ✓，与座位高度 y+0.5 一致 ✓）。
     * 不覆写的话默认是整格 ⇒ 玩家能站在空气上"浮空" ✗（用户 2026-10-09 实机反馈）。
     */
    private static final VoxelShape SHAPE = Shapes.or(
            Block.box(2.0, 0.0, 2.0, 14.0, 8.0, 14.0));

    @Override
    protected VoxelShape getShape(BlockState state, BlockGetter level, BlockPos pos, CollisionContext ctx) {
        return SHAPE;
    }
}