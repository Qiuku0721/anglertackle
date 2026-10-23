package com.whitecobalt.anglertackle.event;

import com.whitecobalt.anglertackle.AnglersTackle;
import com.whitecobalt.anglertackle.fishing.Tuning;
import com.whitecobalt.anglertackle.item.Quality;
import com.whitecobalt.anglertackle.title.TitleDefs;
import com.whitecobalt.anglertackle.title.Titles;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerPlayer;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.EventBusSubscriber;
import net.neoforged.neoforge.event.ServerChatEvent;

/**
 * 聊天里的**称号后缀**（用户 2026-10-11："拥有称号的玩家在发言时名字后自动后缀称号，
 * 后再加引号才是发言内容，如 {@code 玩家[称号]：发言内容}"）。
 *
 * <h2>三种模式（配置 {@code titles.chatMode}）</h2>
 * <ul>
 *   <li><b>{@code full_line}（默认，用户要的那个格式）</b> —— 拦下这条聊天、自己广播：
 *       {@code 玩家[称号]：内容}。代价：这条消息变成"系统消息"（不进 1.19+ 的签名聊天
 *       举报链、别的聊天类模组看不到原始签名）；</li>
 *   <li><b>{@code message_only}</b>（退路，用户说"实在有困难可以方案 2"）—— 只改消息内容，
 *       完全保留原版签名聊天，显示成 {@code <玩家> [称号]内容}；</li>
 *   <li><b>{@code vanilla}</b> —— 聊天里一个字都不加（称号仍可在 {@code /atl title list} 看到）。</li>
 * </ul>
 *
 * <h2>三条纪律</h2>
 * <ol>
 *   <li><b>没佩戴称号的玩家，聊天行为逐字不变</b> —— 事件不取消、消息不改（纯加法）；</li>
 *   <li><b>别人也看得到</b> —— {@code full_line} 走的是 {@code broadcastSystemMessage}
 *       （服务端广播），不是"只发给自己"那种客户端花架子 ✓；</li>
 *   <li>任何异常都**吞掉并放行原版聊天** —— 聊天坏了比称号不显示严重得多。</li>
 * </ol>
 */
@EventBusSubscriber(modid = AnglersTackle.MOD_ID)
public final class TitleChatEvents {

    private TitleChatEvents() {
    }

    @SubscribeEvent
    public static void onChat(ServerChatEvent event) {
        try {
            ServerPlayer player = event.getPlayer();
            if (player == null) {
                return;
            }
            // 0 = full_line（默认，用户要的格式）/ 1 = message_only（退路）/ 2 = vanilla（关）
            int mode = Tuning.titleChatMode();
            if (mode >= 2) {
                return;
            }
            String id = Titles.get(player).equipped();
            if (id.isEmpty() || !Titles.get(player).has(id)) {
                return;   // 没佩戴（或佩了个已经没有的 id）⇒ 原版聊天照旧 ✓
            }
            // 品质与名字都走 Titles（实例 id 在这里也要认得出：`docs/39` §5）
            int quality = Titles.qualityOf(id);
            Component titleName = Component.translatable(Titles.nameKey(id), Titles.nameArgs(id))
                    .withStyle(Quality.of(quality).color());

            String raw = event.getRawText() == null ? "" : event.getRawText();
            if (mode == 1) {
                // 方案 2：只换消息内容，原版签名聊天原样保留（显示成 <玩家> [称号]内容）
                event.setMessage(Component.literal("[")
                        .append(titleName)
                        .append(Component.literal("]" + raw)));
                return;
            }

            // 方案 3（默认）：拦下并自行广播 —— 玩家[称号]：内容
            event.setCanceled(true);
            Component line = Component.literal(player.getName().getString() + "[")
                    .append(titleName)
                    .append(Component.literal("]：" + raw));
            player.level().getServer().getPlayerList().broadcastSystemMessage(line, false);
        } catch (Throwable t) {
            // 称号只是附加信息：绝不让它把聊天带崩（异常时原版那条照样发出去）
            AnglersTackle.LOGGER.warn("[垂纶] 聊天称号后缀失败（已放行原版聊天）：{}", t.toString());
        }
    }
}
