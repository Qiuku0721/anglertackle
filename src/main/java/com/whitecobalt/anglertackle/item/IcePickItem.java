package com.whitecobalt.anglertackle.item;

import com.whitecobalt.anglertackle.block.IceHoleBlock;
import com.whitecobalt.anglertackle.fishing.IceFishing;
import com.whitecobalt.anglertackle.registry.ModBlocks;
import net.minecraft.core.BlockPos;
import net.minecraft.sounds.SoundEvents;
import net.minecraft.sounds.SoundSource;
import net.minecraft.world.InteractionResult;
import net.minecraft.world.entity.EquipmentSlot;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.context.UseOnContext;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.block.state.BlockState;

/**
 * 凿冰镐 —— 冰钓的入口工具（用户 2026-10-08 定案，docs/33 §8.2）。
 *
 * <table>
 *   <tr><th>右键</th><th>结果</th></tr>
 *   <tr><td>四种冰（{@code ice / packed_ice / blue_ice / frosted_ice}）</td><td>变成冰洞</td></tr>
 *   <tr><td>冰洞</td><td>变成碎冰</td></tr>
 *   <tr><td>碎冰 / 浮冰 / 别的</td><td>无效果（防刷 ✓）</td></tr>
 * </table>
 *
 * <p>配方 = 4 铁锭 + 2 木棍（仿铁镐）；耐久 250、凿一次扣 {@code icePickDurabilityCost}（默认 1）。
 * 不走六槽配件体系（那是钓竿的），跟 {@code FishKnifeItem} 一样是独立工具 ✓
 *
 * <p>⚠ 每次凿都要**扣耐久**：这里用的是 {@code hurtAndBreak}，所以创造模式不会掉耐久、
 * 耐久见底会正常损坏 ✓
 */
public class IcePickItem extends Item {

    /**
     * 耐久上限（用户 2026-10-08 定的建议值，docs/33 §8.2）。
     *
     * <p>凿一次扣 {@code icePickDurabilityCost}（默认 1），所以默认能凿 250 次 ——
     * 与铁镐同量级。**注册处引用这个常量**，不要在那儿再写一个字面量 250。
     */
    public static final int DURABILITY = 250;

    public IcePickItem(Properties properties) {
        super(properties);
    }

    /** 四种冰都算"冰面" —— 与用户口径一致（docs/33 §8.1 的 state 图第一行）。 */
    public static boolean isIce(BlockState state) {
        return state.is(Blocks.ICE) || state.is(Blocks.PACKED_ICE)
                || state.is(Blocks.BLUE_ICE) || state.is(Blocks.FROSTED_ICE);
    }

    @Override
    public InteractionResult useOn(UseOnContext ctx) {
        Level level = ctx.getLevel();
        BlockPos pos = ctx.getClickedPos();
        BlockState state = level.getBlockState(pos);

        Block target;
        if (isIce(state)) {
            target = ModBlocks.ICE_HOLE.get();
        } else if (state.getBlock() instanceof IceHoleBlock) {
            target = ModBlocks.BROKEN_ICE.get();
        } else {
            // 碎冰 / 浮冰 / 任何别的东西：**什么都不做**。
            // 用户定案"碎冰/浮冰无效果"，那是为了防刷（反复凿不会掉冰也不会重新计时）。
            return InteractionResult.PASS;
        }

        if (level instanceof net.minecraft.server.level.ServerLevel server) {
            server.setBlock(pos, target.defaultBlockState(), Block.UPDATE_ALL);
            // 音效用"玻璃碎"：原版 ice 的破坏音就是它，听起来和砸冰一致 ✓
            server.playSound(null, pos, SoundEvents.GLASS_BREAK, SoundSource.BLOCKS, 1.0F, 0.8F);
            server.levelEvent(2001, pos, Block.getId(target.defaultBlockState()));
            Player player = ctx.getPlayer();
            if (player != null) {
                ItemStack stack = ctx.getItemInHand();
                stack.hurtAndBreak(IceFishing.icePickCost(), player, EquipmentSlot.MAINHAND);
            }
        }
        return level.isClientSide() ? InteractionResult.SUCCESS : InteractionResult.SUCCESS_SERVER;
    }
}
