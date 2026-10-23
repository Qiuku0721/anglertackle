package com.whitecobalt.anglertackle.block;

import com.mojang.serialization.MapCodec;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.InteractionResult;
import net.minecraft.world.ItemInteractionResult;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.context.BlockPlaceContext;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.BaseEntityBlock;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.HorizontalDirectionalBlock;
import net.minecraft.world.level.block.RenderShape;
import net.minecraft.world.level.block.entity.BlockEntity;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.block.state.StateDefinition;
import net.minecraft.world.level.block.state.properties.BooleanProperty;
import net.minecraft.world.level.block.state.properties.DirectionProperty;
import net.minecraft.world.phys.BlockHitResult;
import org.jetbrains.annotations.Nullable;

/**
 * 鱼架：右击把手里的一条鱼摆上去，空手右击取回。
 *
 * <p>只有 {@link com.whitecobalt.anglertackle.item.FishItem} 能放 ——
 * 别的物品放上去既没有模型也没有意义。
 */
public class FishRackBlock extends BaseEntityBlock {

    public static final MapCodec<FishRackBlock> CODEC = simpleCodec(FishRackBlock::new);
    public static final DirectionProperty FACING = HorizontalDirectionalBlock.FACING;

    /**
     * 架子上有没有鱼。
     *
     * <p>这是**冗余**的（方块实体里也存着那条鱼），但它是必须的：
     * 方块实体的同步包在某些时序下不可靠，表现为"把鱼拿下来之后模型还留着，
     * 直到放了新鱼才刷新"。方块状态的同步由引擎保证，不会漏。
     * 渲染器第一件事就是查这个属性，查不到就直接不画。
     */
    public static final BooleanProperty HAS_FISH = BooleanProperty.create("has_fish");

    public FishRackBlock(Properties properties) {
        super(properties);
        this.registerDefaultState(this.stateDefinition.any()
                .setValue(FACING, Direction.NORTH)
                .setValue(HAS_FISH, false));
    }

    @Override
    protected MapCodec<? extends BaseEntityBlock> codec() {
        return CODEC;
    }

    @Override
    protected void createBlockStateDefinition(StateDefinition.Builder<Block, BlockState> builder) {
        builder.add(FACING, HAS_FISH);
    }

    @Override
    public BlockState getStateForPlacement(BlockPlaceContext context) {
        return this.defaultBlockState().setValue(FACING,
                context.getHorizontalDirection().getOpposite());
    }

    @Override
    protected RenderShape getRenderShape(BlockState state) {
        // 方块本体是普通模型；鱼由 BlockEntityRenderer 另外画
        return RenderShape.MODEL;
    }

    @Nullable
    @Override
    public BlockEntity newBlockEntity(BlockPos pos, BlockState state) {
        return new FishRackBlockEntity(pos, state);
    }

    @Override
    protected ItemInteractionResult useItemOn(ItemStack stack, BlockState state, Level level,
                                              BlockPos pos, Player player, InteractionHand hand,
                                              BlockHitResult hit) {
        if (!(stack.getItem() instanceof com.whitecobalt.anglertackle.item.FishItem)) {
            return ItemInteractionResult.PASS_TO_DEFAULT_BLOCK_INTERACTION;
        }
        if (level.getBlockEntity(pos) instanceof FishRackBlockEntity rack && rack.fish().isEmpty()) {
            if (!level.isClientSide()) {
                rack.setFish(stack.copyWithCount(1));
                stack.shrink(1);
                level.setBlock(pos, state.setValue(HAS_FISH, true), 3);
            }
            return ItemInteractionResult.sidedSuccess(level.isClientSide());
        }
        return ItemInteractionResult.PASS_TO_DEFAULT_BLOCK_INTERACTION;
    }

    @Override
    protected InteractionResult useWithoutItem(BlockState state, Level level, BlockPos pos,
                                               Player player, BlockHitResult hit) {
        if (level.getBlockEntity(pos) instanceof FishRackBlockEntity rack && !rack.fish().isEmpty()) {
            if (!level.isClientSide()) {
                ItemStack out = rack.fish();
                rack.setFish(ItemStack.EMPTY);
                // ⚠ 这一句是"拿下来之后模型还留着"的修复：方块状态一定会同步到客户端，
                //   渲染器据此立刻停画，不依赖方块实体数据包的时序。
                level.setBlock(pos, state.setValue(HAS_FISH, false), 3);
                if (!player.getInventory().add(out)) {
                    player.drop(out, false);
                }
            }
            return InteractionResult.sidedSuccess(level.isClientSide());
        }
        return InteractionResult.PASS;
    }

    @Override
    protected void onRemove(BlockState state, Level level, BlockPos pos, BlockState newState,
                            boolean movedByPiston) {
        if (!state.is(newState.getBlock())
                && level.getBlockEntity(pos) instanceof FishRackBlockEntity rack
                && !rack.fish().isEmpty()) {
            net.minecraft.world.Containers.dropItemStack(level, pos.getX(), pos.getY(), pos.getZ(),
                    rack.fish());
        }
        super.onRemove(state, level, pos, newState, movedByPiston);
    }
}
