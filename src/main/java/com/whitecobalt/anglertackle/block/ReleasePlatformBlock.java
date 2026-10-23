package com.whitecobalt.anglertackle.block;

import com.mojang.serialization.MapCodec;
import net.minecraft.core.BlockPos;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.InteractionResult;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.phys.BlockHitResult;

/**
 * 放生台：手持鱼物品右击，把这条鱼放回附近的水里（{@code docs/20} §3.5）。
 *
 * <p><b>为什么是普通方块、没有方块实体</b>：放生是一次性动作 ——
 * 查手里的东西、在附近找一片放得下的水、生成实体、扣掉物品，流程就结束了，
 * 台子上不留任何需要存档的东西。做成方块实体只会多一份要同步、要落盘、
 * 还要处理"区块没加载"的状态，换不来任何东西。
 *
 * <p><b>为什么这一层什么都不做</b>：找水、生成实体、扣物品全在
 * {@code AquariumTank.releaseFromPlatform} 里。水族箱（把鱼放进缸）和
 * 放生台（把鱼放回河）必须共用同一份"这片水装得下这条鱼吗"的判定 ——
 * 分开写两份，迟早会漂移出"缸里放得下、河里放不下"这类自相矛盾的规则。
 * 所以这里只负责"方块被右击了"这一件事，转发出去就完。
 *
 * <p>属性取木头、强度 2.0（比鱼架的 0.8 硬一档）：台子是要长期摆在水边的，
 * 一碰就掉会逼玩家反复重放，而它本身不值钱、没有保护的必要。
 */
public class ReleasePlatformBlock extends Block {

    public static final MapCodec<ReleasePlatformBlock> CODEC = simpleCodec(ReleasePlatformBlock::new);

    public ReleasePlatformBlock(Properties properties) {
        super(properties);
    }

    @Override
    protected MapCodec<? extends ReleasePlatformBlock> codec() {
        return CODEC;
    }

    /**
     * 右击交互。用 {@link InteractionResult}（和 {@link FishRackBlock} 一致）：
     * 26.1.2 的方块交互里，{@link InteractionResult#TRY_WITH_EMPTY_HAND} 表示
     * "先试默认的 {@code useWithoutItem}"，它不消费这次右键时才会回退到"手上物品自己用"——
     * 也就是说不拿鱼右键时，水桶、骨粉这些该干嘛干嘛。
     *
     * <p>这一层**刻意不做任何加工**，直接转发返回值。非默认交互的那一侧由
     * {@code AquariumTank} 负责，它按方块交互的惯例用
     * {@link InteractionResult#SUCCESS}（客户端）／{@link InteractionResult#SUCCESS_SERVER}（服务端）：
     * 世界改动只在服务端做，客户端返回"成功"是为了把挥手动画和音效演出来 ——
     * 这就是本模组其它交互（见 {@link FishRackBlock#useItemOn}）一直在用的写法。
     */
    @Override
    protected InteractionResult useItemOn(ItemStack stack, BlockState state, Level level,
                                              BlockPos pos, Player player, InteractionHand hand,
                                              BlockHitResult hit) {
        return com.whitecobalt.anglertackle.block.AquariumTank.releaseFromPlatform(stack, level, pos, player);
    }
}
