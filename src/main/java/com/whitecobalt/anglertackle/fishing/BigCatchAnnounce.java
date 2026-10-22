package com.whitecobalt.anglertackle.fishing;

import net.minecraft.network.chat.Component;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerPlayer;

/**
 * **大鱼公告** —— 用户 2026-10-11 定案："**不加共享**（红档信息共享给附近 60 格的玩家不做）、
 * **公告可以搞**"。
 *
 * <h2>它是什么</h2>
 * 玩家钓到"价值 ≥ {@link Tuning#bigCatchAnnounceValue()} 鱼币"的鱼时，**向全服公告一条**。
 * 价值口径与卖价**同一个函数**（{@code CoinPricing.priceFor(档位, 尺寸系数)}）——
 * 公告里写的钱数与玩家真去商店卖出来的钱**必须是一个数**；两处各算一份，迟早打架 ✗。
 *
 * <h2>三条闸门（缺一条这个功能就会变成骚扰）</h2>
 * <ol>
 *   <li><b>价值门槛</b>（服务器级配置）：低于它的鱼不公告 —— 否则一条鲫鱼也上聊天栏 ✗；</li>
 *   <li><b>玩家自己的开关</b>（{@code PlayerFishingData.bigCatchAnnounce}，默认开）：
 *       有人就是不想被围观 ✓ 用户定案"必须在设置界面能自由开关 + 退出重进也保留" ⇒
 *       存在**服务端**的玩家附件里（见 {@code docs/34-玩家设置界面策划案.md}）；</li>
 *   <li><b>最小间隔</b>（服务器级配置，默认 10 秒）：防"一群人同时上鱼"或"一个人连竿"刷屏 ✓。</li>
 * </ol>
 *
 * <h2>为什么挂在 {@code FishingManager.onCatch} 那一处</h2>
 * 那里是**上鱼成功那一帧**的唯一收口（图鉴记账、里程碑、经验、售价都在它旁边）⇒
 * 天然服务端权威 ✓、与排行榜/图鉴同一份事实 ✓、不需要任何客户端上报 ✓。
 *
 * <p>⚠ 单人存档里它同样生效（"全服"就是自己一个人）—— 这不是 bug：
 * 用户要的是"钓到大鱼有个仪式感"，单人玩家也看得到那条公告。
 */
public final class BigCatchAnnounce {

    /**
     * 上一次公告的时间（按**世界 gameTime** 算）。
     *
     * <p>⚠ 两个字段必须**成对**使用：单机玩家退出世界再进另一个存档时，
     * JVM 里这个静态字段会带着上一个世界的时刻活下来 ⇒ 新世界开场可能被
     * "上一个世界 3 秒前刚公告过"误伤（少公告一条，不报错 ✗）。
     * 所以下面用 {@link #lastServer} 认服务器实例，一换就重置 ✓。
     */
    private static MinecraftServer lastServer = null;
    private static long lastAnnounceGameTime = Long.MIN_VALUE;

    private BigCatchAnnounce() {
    }

    /**
     * 可能公告一条（不够格 / 被关掉 / 被节流就什么都不做）。
     *
     * @param player   钓到鱼的玩家（服务端）
     * @param fishName 鱼的**本地化名字**（调用方已经从物品栈取好 —— 这里不碰注册表，纯拼文本）
     * @param kg       重量
     * @param value    这条鱼的价值（鱼币），由调用方用与卖价同一个函数算好
     */
    public static void maybeAnnounce(ServerPlayer player, Component fishName, float kg, long value) {
        try {
            MinecraftServer server = player.getServer();
            if (server == null) {
                return;
            }
            if (server != lastServer) {
                // 换服务器/换存档 ⇒ 节流窗口从零开始（见字段注释）
                lastServer = server;
                lastAnnounceGameTime = Long.MIN_VALUE;
            }

            // 闸门①：价值门槛（服务器级）
            int threshold = Tuning.bigCatchAnnounceValue();
            if (value < threshold) {
                return;
            }

            // 闸门②：玩家自己的开关（默认开；存在玩家附件里 ⇒ 退出重进也保留）
            if (!com.whitecobalt.anglertackle.player.PlayerData.get(player).bigCatchAnnounce()) {
                return;
            }

            // 闸门③：最小间隔（服务器级）
            long now = player.level().getGameTime();
            int gap = Tuning.bigCatchAnnounceMinIntervalSec();
            if (gap > 0 && lastAnnounceGameTime != Long.MIN_VALUE
                    && now - lastAnnounceGameTime < gap * 20L) {
                return;
            }
            lastAnnounceGameTime = now;

            // ★ 全服公告（false = 不进"仅 OP 可见"的那种；就是普通聊天栏消息）
            server.getPlayerList().broadcastSystemMessage(
                    Component.translatable("message.anglertackle.big_catch",
                            player.getName().getString(),
                            fishName,
                            String.format("%.2f", kg),
                            String.valueOf(value)),
                    false);

            com.whitecobalt.anglertackle.AnglersTackle.LOGGER.info(
                    "[垂纶] 大鱼公告：{} 钓到 {} {}kg 价值 {} 币（门槛 {}）",
                    player.getName().getString(), fishName.getString(),
                    String.format("%.2f", kg), value, threshold);
        } catch (Throwable ignored) {
            // 公告是**锦上添花**：它出任何问题都绝不能把"上鱼结算"搞崩（那会丢鱼 ✗）
        }
    }
}
