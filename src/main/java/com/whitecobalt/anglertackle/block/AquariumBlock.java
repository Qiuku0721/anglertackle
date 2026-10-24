package com.whitecobalt.anglertackle.block;

import com.mojang.serialization.MapCodec;
import com.whitecobalt.anglertackle.fishing.FishData;
import com.whitecobalt.anglertackle.registry.ModDataComponents;
import java.util.List;
import java.util.Map;
import java.util.Set;
import net.minecraft.ChatFormatting;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.util.RandomSource;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.InteractionResult;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.Level;
import net.minecraft.world.phys.BlockHitResult;
import net.minecraft.world.item.context.BlockPlaceContext;
import net.minecraft.world.level.BlockGetter;
import net.minecraft.world.level.LevelAccessor;
import net.minecraft.world.level.LevelReader;
import net.minecraft.world.level.ScheduledTickAccess;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.SimpleWaterloggedBlock;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.block.state.StateDefinition;
import net.minecraft.world.level.block.state.properties.BlockStateProperties;
import net.minecraft.world.level.block.state.properties.BooleanProperty;
import net.minecraft.world.level.material.FluidState;
import net.minecraft.world.level.material.Fluids;
import net.minecraft.world.phys.shapes.CollisionContext;
import net.minecraft.world.phys.shapes.Shapes;
import net.minecraft.world.phys.shapes.VoxelShape;

/**
 * 水族箱方块 —— 拼起来是一口**无缝**的缸。
 *
 * <p>三条设计口径（{@code docs/20}，用户已拍板）：
 * <ol>
 *   <li><b>方块本身就是水</b>：永远 waterlogged，{@code getFluidState} 返回水源。
 *       这样 {@code AbstractFish.isInWater()} 为真，鱼才能在里面正常游 ——
 *       否则它们会一直处于"搁浅扑腾"状态。贴图/模型不画水，水是看不见的介质。</li>
 *   <li><b>硬壳、空心</b>：壁**只在露在外面的那一面**才有。相邻的格子互相咬合，
 *       所以 3×3×3 拼出来是一个整块玻璃缸，而不是 27 个小鱼缸。</li>
 *   <li><b>壁厚 2/16 格</b>（比原版玻璃板厚一点，看起来像缸壁而不是窗玻璃）。</li>
 * </ol>
 *
 * <p><b>为什么连接状态存在方块状态里而不是查世界</b>：{@code getCollisionShape}
 * 会在区块加载、实体寻路等时机被调用，那时候查邻居方块可能触发区块加载 —— 死锁。
 * 六向 boolean 在 {@link #updateShape} 里维护，读的时候只看自己。
 */
public class AquariumBlock extends Block implements SimpleWaterloggedBlock {

    public static final MapCodec<AquariumBlock> CODEC = simpleCodec(AquariumBlock::new);
    public static final BooleanProperty WATERLOGGED = BlockStateProperties.WATERLOGGED;

    /** 六个方向的"邻居也是水族箱"。true = 那一面被咬合，不画壁。 */
    public static final BooleanProperty NORTH = BooleanProperty.create("north");
    public static final BooleanProperty SOUTH = BooleanProperty.create("south");
    public static final BooleanProperty EAST = BooleanProperty.create("east");
    public static final BooleanProperty WEST = BooleanProperty.create("west");
    public static final BooleanProperty UP = BooleanProperty.create("up");
    public static final BooleanProperty DOWN = BooleanProperty.create("down");

    private static final Map<Direction, BooleanProperty> SIDES = Map.of(
            Direction.NORTH, NORTH, Direction.SOUTH, SOUTH,
            Direction.EAST, EAST, Direction.WEST, WEST,
            Direction.UP, UP, Direction.DOWN, DOWN);

    /** 壁厚 2/16。 */
    private static final double T = 2.0D;

    public AquariumBlock(Properties properties) {
        super(properties);
        BlockState st = this.stateDefinition.any().setValue(WATERLOGGED, true);
        for (BooleanProperty p : SIDES.values()) {
            st = st.setValue(p, false);
        }
        this.registerDefaultState(st);
    }

    @Override
    protected MapCodec<? extends AquariumBlock> codec() {
        return CODEC;
    }

    @Override
    protected void createBlockStateDefinition(StateDefinition.Builder<Block, BlockState> builder) {
        builder.add(WATERLOGGED, NORTH, SOUTH, EAST, WEST, UP, DOWN);
    }

    // ---------------------------------------------------------------- 水
    @Override
    protected FluidState getFluidState(BlockState state) {
        return Fluids.WATER.getSource(false);
    }

    @Override
    public ItemStack pickupBlock(LivingEntity user, LevelAccessor level, BlockPos pos,
                                 BlockState state) {
        return ItemStack.EMPTY;   // 缸里的水舀不走
    }

    @Override
    public boolean canPlaceLiquid(LivingEntity user, BlockGetter level, BlockPos pos,
                                  BlockState state,
                                  net.minecraft.world.level.material.Fluid fluid) {
        return false;
    }

    // ---------------------------------------------------------------- 连接状态
    private static boolean connected(BlockGetter level, BlockPos pos, Direction dir) {
        return level.getBlockState(pos.relative(dir)).getBlock() instanceof AquariumBlock;
    }

    private static BlockState withConnections(BlockState state, BlockGetter level, BlockPos pos) {
        for (Map.Entry<Direction, BooleanProperty> e : SIDES.entrySet()) {
            state = state.setValue(e.getValue(), connected(level, pos, e.getKey()));
        }
        return state;
    }

    @Override
    public BlockState getStateForPlacement(BlockPlaceContext context) {
        return withConnections(this.defaultBlockState(), context.getLevel(), context.getClickedPos());
    }

    @Override
    protected BlockState updateShape(BlockState state, LevelReader level, ScheduledTickAccess ticks,
                                     BlockPos pos, Direction directionToNeighbour,
                                     BlockPos neighbourPos, BlockState neighbourState,
                                     RandomSource random) {
        BooleanProperty p = SIDES.get(directionToNeighbour);
        if (p != null) {
            state = state.setValue(p, neighbourState.getBlock() instanceof AquariumBlock);
        }
        // 水永远补满（缸破了也会立刻回满，避免出现"半缸水"）
        ticks.scheduleTick(pos, Fluids.WATER, Fluids.WATER.getTickDelay(level));
        return state;
    }

    @Override
    protected void tick(BlockState state, ServerLevel level, BlockPos pos, RandomSource random) {
        if (!state.getValue(WATERLOGGED)) {
            level.setBlock(pos, state.setValue(WATERLOGGED, true), 3);
        }
    }

    // ---------------------------------------------------------------- 放鱼 / 取鱼
    //
    // 第二阶段（docs/20 §A2–A4）：手持鱼右键放进缸里，空手右键拿回来。
    // 体积、容量、鱼在哪，全部**现算**（见 AquariumTank 顶部"为什么不用方块实体"）。

    /**
     * 放鱼：手持 {@link com.whitecobalt.anglertackle.item.FishItem} 右键。
     *
     * <p>容量不够时**不消耗物品**，并且明确告诉玩家差多少格 ——
     * 只说"放不下"的话，玩家会以为是坏了，而不是"缸太小"。
     */
    @Override
    protected InteractionResult useItemOn(ItemStack stack, BlockState state, Level level,
                                              BlockPos pos, Player player, InteractionHand hand,
                                              BlockHitResult hit) {
        if (!(stack.getItem() instanceof com.whitecobalt.anglertackle.item.FishItem)) {
            return InteractionResult.TRY_WITH_EMPTY_HAND;
        }
        // 客户端先乐观地当作成功（和 FishRackBlock 同一套路）：
        // 容量判定要用鱼的个体数据，那是服务端才有的，客户端算出来会和服务器不一致。
        if (level.isClientSide()) {
            return InteractionResult.SUCCESS;
        }
        ServerLevel server = (ServerLevel) level;
        FishData data = stack.get(ModDataComponents.FISH_DATA.get());
        if (data == null) {
            return InteractionResult.FAIL;
        }
        Set<BlockPos> volume = AquariumTank.flood(server, pos);
        if (volume == null) {
            return AquariumTank.reject(player, "message.anglertackle.aquarium_too_big",
                    AquariumTank.MAX_BLOCKS);
        }
        int need = AquariumTank.requiredBlocks(data.lengthCm());
        int used = AquariumTank.usedBlocks(AquariumTank.fishIn(server, volume));
        if (used + need > volume.size()) {
            return AquariumTank.reject(player, "message.anglertackle.aquarium_full",
                    volume.size(), used, need);
        }
        Component name = stack.getHoverName();
        if (!AquariumTank.addFish(server, volume, data)) {
            return InteractionResult.FAIL;
        }
        stack.shrink(1);
        player.sendOverlayMessage(Component.translatable("message.anglertackle.aquarium_added", name)
                .withStyle(ChatFormatting.GREEN));
        return InteractionResult.SUCCESS_SERVER;
    }

    /**
     * 取鱼：空手右键，拿走**离玩家最近**的那一条。
     *
     * <p>为什么是"最近"而不是"第一条/最后一条"：玩家的意图几乎总是"我要眼前这条"，
     * 而"第一条"取决于实体遍历顺序 —— 那是随机的，玩家会觉得"取出来的鱼不对"。
     *
     * <p>客户端也做一次同样的检查（鱼实体是同步到客户端的），
     * 所以缸里没鱼时不会白挥手。
     */
    @Override
    protected InteractionResult useWithoutItem(BlockState state, Level level, BlockPos pos,
                                               Player player, BlockHitResult hit) {
        Set<BlockPos> volume = AquariumTank.flood(level, pos);
        if (volume == null) {
            return InteractionResult.PASS;
        }
        List<com.whitecobalt.anglertackle.entity.ModFish> fish = AquariumTank.fishIn(level, volume);
        if (fish.isEmpty()) {
            return InteractionResult.PASS;
        }
        if (level.isClientSide()) {
            return InteractionResult.SUCCESS;
        }
        com.whitecobalt.anglertackle.entity.ModFish pick = fish.get(0);
        double best = Double.MAX_VALUE;
        for (com.whitecobalt.anglertackle.entity.ModFish f : fish) {
            double d = f.distanceToSqr(player);
            if (d < best) {
                best = d;
                pick = f;
            }
        }
        ItemStack out = AquariumTank.toItemStack(pick, player);
        if (out.isEmpty()) {
            return InteractionResult.PASS;
        }
        pick.discard();
        if (!player.getInventory().add(out)) {
            player.drop(out, false);
        }
        player.sendOverlayMessage(Component.translatable("message.anglertackle.aquarium_removed",
                out.getHoverName()).withStyle(ChatFormatting.YELLOW));
        return InteractionResult.SUCCESS_SERVER;
    }

    /**
     * 拆缸：破了个洞就**把鱼放出来**，绝不杀掉（docs/20 §5③）。
     *
     * <p>解禁而不是"传送到安全水域"：水都漏光了，它们本来就该在原地搁浅扑腾 ——
     * 那是玩家拆缸的自然后果，也是最好懂的表现。
     */
    @Override
    protected void affectNeighborsAfterRemoval(BlockState state, ServerLevel level, BlockPos pos,
                                               boolean movedByPiston) {
        // 与旧 onRemove 的等价：钩子只在旧方块确实被换掉时才调用（LevelChunk.java:318-321），
        // 此刻 pos 上已经是新方块，所以用 level.getBlockState(pos) 代替原来的 newState 判定。
        if (!state.is(level.getBlockState(pos).getBlock())) {
            AquariumTank.releaseAll(level, pos);
        }
        super.affectNeighborsAfterRemoval(state, level, pos, movedByPiston);
    }

    // ---------------------------------------------------------------- 碰撞：只给露出的面加薄壁
    @Override
    protected VoxelShape getCollisionShape(BlockState state, BlockGetter level, BlockPos pos,
                                           CollisionContext context) {
        VoxelShape shape = Shapes.empty();
        if (!state.getValue(NORTH)) {
            shape = Shapes.joinUnoptimized(shape, Block.box(0, 0, 0, 16, 16, T), net.minecraft.world.phys.shapes.BooleanOp.OR);
        }
        if (!state.getValue(SOUTH)) {
            shape = Shapes.joinUnoptimized(shape, Block.box(0, 0, 16 - T, 16, 16, 16), net.minecraft.world.phys.shapes.BooleanOp.OR);
        }
        if (!state.getValue(WEST)) {
            shape = Shapes.joinUnoptimized(shape, Block.box(0, 0, 0, T, 16, 16), net.minecraft.world.phys.shapes.BooleanOp.OR);
        }
        if (!state.getValue(EAST)) {
            shape = Shapes.joinUnoptimized(shape, Block.box(16 - T, 0, 0, 16, 16, 16), net.minecraft.world.phys.shapes.BooleanOp.OR);
        }
        if (!state.getValue(DOWN)) {
            shape = Shapes.joinUnoptimized(shape, Block.box(0, 0, 0, 16, T, 16), net.minecraft.world.phys.shapes.BooleanOp.OR);
        }
        if (!state.getValue(UP)) {
            shape = Shapes.joinUnoptimized(shape, Block.box(0, 16 - T, 0, 16, 16, 16), net.minecraft.world.phys.shapes.BooleanOp.OR);
        }
        return shape.optimize();
    }

    /** 露出的面不挡光、不挡视线（缸里要能看见鱼）。 */
    @Override
    protected VoxelShape getVisualShape(BlockState state, BlockGetter level, BlockPos pos,
                                        CollisionContext context) {
        return Shapes.empty();
    }

    /**
     * 活塞推不动（docs/20 §8.4 的建议）。
     *
     * <p>水族箱是**多方块结构**：连接状态存在每一格自己的方块状态里。活塞把其中一格
     * 推走时，那一格会带着"我跟邻居相连"的旧状态落到新位置，而邻居那边仍然认为
     * 它在原地 —— 结果是画出根本不存在的壁、判定箱也错位，玩家看到一口"幽灵缸"。
     * 多方块结构普遍直接禁止推动（原版床、门也是这么处理的）。
     *
     * <p>爆炸**允许**破坏：那条路径会走到 {@link #onRemove}，鱼会被正常放出来。
     */
    @Override
    public net.minecraft.world.level.material.PushReaction getPistonPushReaction(BlockState state) {
        return net.minecraft.world.level.material.PushReaction.BLOCK;
    }

    @Override
    protected boolean propagatesSkylightDown(BlockState state) {
        return true;
    }

    @Override
    protected float getShadeBrightness(BlockState state, BlockGetter level, BlockPos pos) {
        return 1.0F;
    }

    @Override
    protected boolean skipRendering(BlockState state, BlockState neighborState, Direction side) {
        // 相邻也是水族箱时不画接缝 —— 这是"拼起来是一整块"的最后一道保险
        return neighborState.getBlock() instanceof AquariumBlock;
    }
}
