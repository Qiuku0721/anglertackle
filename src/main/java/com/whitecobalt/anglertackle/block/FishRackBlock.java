package com.whitecobalt.anglertackle.block;

import com.mojang.serialization.MapCodec;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.InteractionResult;
import net.minecraft.world.entity.item.ItemEntity;
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
import net.minecraft.world.level.block.state.properties.EnumProperty;
import net.minecraft.world.level.storage.loot.LootParams;
import net.minecraft.world.level.storage.loot.parameters.LootContextParams;
import net.minecraft.world.phys.BlockHitResult;
import java.util.ArrayList;
import java.util.List;
import org.jetbrains.annotations.Nullable;

/**
 * 鱼架：右击把手里的一条鱼摆上去，空手右击取回。
 *
 * <p>只有 {@link com.whitecobalt.anglertackle.item.FishItem} 能放 ——
 * 别的物品放上去既没有模型也没有意义。
 */
public class FishRackBlock extends BaseEntityBlock {

    public static final MapCodec<FishRackBlock> CODEC = simpleCodec(FishRackBlock::new);
    public static final EnumProperty<Direction> FACING = HorizontalDirectionalBlock.FACING;

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
    protected InteractionResult useItemOn(ItemStack stack, BlockState state, Level level,
                                              BlockPos pos, Player player, InteractionHand hand,
                                              BlockHitResult hit) {
        if (!(stack.getItem() instanceof com.whitecobalt.anglertackle.item.FishItem)) {
            return InteractionResult.TRY_WITH_EMPTY_HAND;
        }
        if (level.getBlockEntity(pos) instanceof FishRackBlockEntity rack && rack.fish().isEmpty()) {
            if (!level.isClientSide()) {
                rack.setFish(stack.copyWithCount(1));
                stack.shrink(1);
                level.setBlock(pos, state.setValue(HAS_FISH, true), 3);
            }
            return level.isClientSide() ? InteractionResult.SUCCESS : InteractionResult.SUCCESS_SERVER;
        }
        return InteractionResult.TRY_WITH_EMPTY_HAND;
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
            return level.isClientSide() ? InteractionResult.SUCCESS : InteractionResult.SUCCESS_SERVER;
        }
        return InteractionResult.PASS;
    }

    /**
     * 创造模式拆除的补偿：{@code preventsBlockDrops()}（= instabuild）时原版走的是
     * 「不调 {@code playerDestroy}、不产生掉落」的路径，鱼会跟着方块实体一起消失。
     * 旧实现的 {@code onRemove} 是「服务端每次方块变更都调用」的通用回调
     * （1.21.1 反编译可证：{@code LevelChunk.setBlockState} 里先 {@code onRemove}、
     * 之后才 {@code removeBlockEntity}），所以创造模式拆架子也会吐鱼；
     * 为了不改变可见行为，这里按原版 {@code ShulkerBoxBlock.playerWillDestroy}
     * 的同款写法补一次（{@code ShulkerBoxBlock.java:106-121}）。
     *
     * <p>生存模式不走这里（{@code preventsBlockDrops()} 为 false），掉落在
     * {@link #getDrops} 里；两条路互斥，不会双吐。
     */
    @Override
    public BlockState playerWillDestroy(Level level, BlockPos pos, BlockState state, Player player) {
        if (!level.isClientSide() && player.preventsBlockDrops()
                && level.getBlockEntity(pos) instanceof FishRackBlockEntity rack
                && !rack.fish().isEmpty()) {
            ItemEntity drop = new ItemEntity(level, pos.getX() + 0.5D, pos.getY() + 0.5D,
                    pos.getZ() + 0.5D, rack.fish().copy());
            drop.setDefaultPickUpDelay();
            level.addFreshEntity(drop);
        }
        return super.playerWillDestroy(level, pos, state, player);
    }

    /**
     * 拆掉/炸掉架子时，把架子上那条鱼原样吐出来（<b>不</b>走方块实体的默认掉落）。
     *
     * <p>⚠ 26.1.2 起这个动作**不能再放在 {@code affectNeighborsAfterRemoval} 里**：
     * 那个钩子在方块实体已经被移除**之后**才调用（{@code LevelChunk.java:305-321}），
     * 到那时 {@code level.getBlockEntity(pos)} 已经是 {@code null}，鱼会被静默吞掉。
     * 现行口径是「方块实体里的东西由 {@code preRemoveSideEffects} 或掉落表负责」，
     * 这里走掉落表：{@code Block.dropResources} 在移除方块**之前**就把方块实体塞进
     * {@code LootContextParams.BLOCK_ENTITY}（{@code Level.java:312-315}），
     * 原版 {@code DecoratedPotBlock} 正是用同样的办法把方块实体内容带进掉落的。
     *
     * <p>覆盖「生存破坏」和「爆炸」两条会产生掉落的路径；创造模式由
     * {@link #playerWillDestroy} 补。仍有一处差异：{@code /setblock} 这类
     * 不产生掉落的替换不会吐鱼（旧版 {@code onRemove} 会）—— 要做到逐路径一致，
     * 得把逻辑放进 {@code FishRackBlockEntity.preRemoveSideEffects}，那是方块实体的事。
     */
    @Override
    protected List<ItemStack> getDrops(BlockState state, LootParams.Builder params) {
        List<ItemStack> drops = new ArrayList<>(super.getDrops(state, params));
        if (params.getOptionalParameter(LootContextParams.BLOCK_ENTITY) instanceof FishRackBlockEntity rack
                && !rack.fish().isEmpty()) {
            drops.add(rack.fish().copy());
        }
        return drops;
    }
}
