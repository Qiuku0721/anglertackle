package com.whitecobalt.anglertackle.block;

import com.whitecobalt.anglertackle.fishing.IceFishing;
import com.whitecobalt.anglertackle.registry.ModBlocks;
import net.minecraft.core.BlockPos;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.util.RandomSource;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.state.BlockState;

/**
 * 碎冰 —— 冰洞被凿冰镐砸过之后的形态（docs/33 §8.1）。
 *
 * <p>状态机：碎冰 --闲置 {@code brokenIceToPackIceMinutes}--> 浮冰 --闲置
 * {@code packIceToIceMinutes}--> 原版冰。
 *
 * <h2>为什么"到点执行"用 scheduleTick 而不是方块实体</h2>
 * 三形态只需要一个**延时**，没有任何需要持久化的数据 —— 用方块实体就要为每个洞
 * 存一份 NBT、还要处理区块卸载/存档迁移，全是白搭。{@code scheduleTick} 的调度
 * 由世界自己存，重启也不会丢 ✓
 *
 * <p>⚠ 下一步的浮冰**不是**原版 {@code packed_ice} 方块，而是我们自己的
 * {@link PackIceBlock}：原版方块不会执行我们的 {@code tick}，用它的话
 * "浮冰 → 冰"这第二段就永远不触发（而且不会有任何报错）。外观仍然引用原版材质 ✓
 */
public class BrokenIceBlock extends Block {

    public BrokenIceBlock(Properties properties) {
        super(properties);
    }

    @Override
    public void onPlace(BlockState state, net.minecraft.world.level.Level level, BlockPos pos,
                        BlockState oldState, boolean movedByPiston) {
        super.onPlace(state, level, pos, oldState, movedByPiston);
        if (level instanceof ServerLevel server) {
            server.scheduleTick(pos, this, IceFishing.brokenIceToPackIceTicks());
        }
    }

    @Override
    public void tick(BlockState state, ServerLevel level, BlockPos pos, RandomSource random) {
        level.setBlock(pos, ModBlocks.PACK_ICE.get().defaultBlockState(), Block.UPDATE_ALL);
    }
}
