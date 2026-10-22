package com.whitecobalt.anglertackle.item;

import com.whitecobalt.anglertackle.network.ModNetwork;
import com.whitecobalt.anglertackle.network.TerminalPayload;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.InteractionResultHolder;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.Level;

/**
 * **垂纶终端**（统合界面入口物品；`docs/40` §10 / `docs/41` §8 第 5 项）。
 *
 * <p>用户 2026-10-15 定案的入口形态："做一个终端物品通过右键打开" —— 右键即开，
 * 打开的就是 {@code TerminalScreen}（把委托/图鉴/邮箱/成就/称号/商店/排行榜/联赛/比赛
 * 收进一个入口，替代"每个功能挂在不同物品上"的现状）。
 *
 * <h2>两条纪律</h2>
 * <ul>
 *   <li><b>只在服务端发载荷</b>：界面由服务端推的 {@link TerminalPayload} 打开（与 `/atl terminal`
 *       同一条路）—— 客户端自己 {@code setScreen} 会绕过服务端的权限/状态判断 ✗；
 *       客户端这一侧只返回 {@code consume}（否则不挥手、也不预测）✓。</li>
 *   <li><b>开界面不是"发东西"</b>：终端本身只路由到各模块**无门槛**的入口，
 *       所以这个物品**谁都能用**，不加 OP（`docs/接力.md` §六 的判定标准是"改数 / 发东西"）✓。</li>
 * </ul>
 *
 * <h2>贴图</h2>
 * 按用户 2026-10-15 的决定**复用邮件物品（mailbox）的贴图** —— 不为它新增 PNG，
 * 也就不去动 `check-item-icons.js` 那张"用户验收过的"指纹表（那张表一旦顺手 `--write`
 * 就等于把闸门关掉，仓库里出过这个事故 ✗）。
 */
public class TerminalItem extends Item {

    public TerminalItem(Properties properties) {
        super(properties);
    }

    @Override
    public InteractionResultHolder<ItemStack> use(Level level, Player player, InteractionHand hand) {
        ItemStack stack = player.getItemInHand(hand);
        if (level.isClientSide()) {
            return InteractionResultHolder.consume(stack);
        }
        if (player instanceof ServerPlayer serverPlayer) {
            // 与 `/atl terminal` 完全同一条路：服务端推载荷 → 客户端开界面 ✓
            ModNetwork.sendTo(serverPlayer, new TerminalPayload(9));
        }
        return InteractionResultHolder.consume(stack);
    }
}
