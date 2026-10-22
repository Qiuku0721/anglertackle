package com.whitecobalt.anglertackle.block;

import com.whitecobalt.anglertackle.fishing.IceFishing;
import net.minecraft.core.BlockPos;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.util.RandomSource;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.block.state.BlockState;

/**
 * 浮冰 —— 碎冰化开之后的形态，外形与**原版 {@code packed_ice} 一模一样**
 * （模型直接引用 {@code minecraft:block/packed_ice}，一张新贴图都不画 ✓ 用户 2026-10-08："参考原版不要突兀"）。
 *
 * <h2>为什么不用原版 packed_ice 方块</h2>
 * 因为状态机的最后一段（浮冰 → 冰）得由**这个方块自己**执行 {@code tick}。
 * 原版方块不会跑我们的代码，用它的话那一段**永远不触发、也不报错** ——
 * 玩家只会看到"碎冰化开之后就一直那样"。所以自己注册一个，外观借用原版的。
 *
 * <p>用户定案：浮冰**会**变回冰（默认 10 分钟），于是同一片水面过一会儿又能再凿 ✓
 */
public class PackIceBlock extends Block {

    public PackIceBlock(Properties properties) {
        super(properties);
    }

    @Override
    public void onPlace(BlockState state, net.minecraft.world.level.Level level, BlockPos pos,
                        BlockState oldState, boolean movedByPiston) {
        super.onPlace(state, level, pos, oldState, movedByPiston);
        if (level instanceof ServerLevel server) {
            server.scheduleTick(pos, this, IceFishing.packIceToIceTicks());
        }
    }

    @Override
    public void tick(BlockState state, ServerLevel level, BlockPos pos, RandomSource random) {
        level.setBlock(pos, Blocks.ICE.defaultBlockState(), Block.UPDATE_ALL);
    }
}
