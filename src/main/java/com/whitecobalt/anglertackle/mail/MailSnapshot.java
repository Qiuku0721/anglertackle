package com.whitecobalt.anglertackle.mail;

import com.whitecobalt.anglertackle.fishing.Tuning;
import com.whitecobalt.anglertackle.network.MailPayload;
import com.whitecobalt.anglertackle.player.MailEntry;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.item.ItemStack;

import java.util.ArrayList;
import java.util.List;

/**
 * 把邮箱拍成**一行行平面文本**（`MailPayload` 的行格式在这里定义，只有这一处）。
 *
 * <p>为什么单独一个类、而不是塞进 {@code MailService}：服务端动作与"给客户端看的投影"
 * 是两件事 —— 前者改数据、后者只读；混在一起最容易出的错是"在投影里顺手改了个状态" ✗。
 * 这里**只读**（连 {@code claim} 都不调），看一眼就知道它改不了任何东西 ✓。
 *
 * <p>行格式（竖线分隔，顺序固定，与 {@code MailPayload} 的注释逐字对应）：
 * <pre>
 *   id|template|args|sentAt|read|claimed|coins|items|action|daysLeft|expired
 * </pre>
 */
public final class MailSnapshot {

    private MailSnapshot() {
    }

    /** 行内分隔符：参数用 \u0001、物品用 \u0002（竖线留给字段分隔）。 */
    private static final String SEP_ARG = "\u0001";
    private static final String SEP_ITEM = "\u0002";

    /** 拍一份快照（{@code lastError} 是上一次动作的结果码，空串 = 成功）。 */
    public static MailPayload of(ServerPlayer player, String lastError) {
        return of(player, lastError, true);
    }

    /**
     * 拍一份快照。
     *
     * @param autoOpen 没开着邮箱时**要不要替玩家开窗** —— 玩家主动要看时 {@code true}；
     *                 后台到了一封信时 {@code false}（只刷新缓存，绝不把界面顶掉）
     */
    public static MailPayload of(ServerPlayer player, String lastError, boolean autoOpen) {
        var box = com.whitecobalt.anglertackle.player.PlayerData.getMails(player);
        List<String> rows = new ArrayList<>(box.mails().size());
        for (MailEntry m : MailService.list(player)) {
            rows.add(row(m));
        }
        return new MailPayload(rows, box.unread(), box.claimable(),
                Tuning.mailMaxMails(), lastError == null ? "" : lastError, autoOpen);
    }

    private static String row(MailEntry m) {
        StringBuilder sb = new StringBuilder(96);
        sb.append(m.id()).append('|');
        sb.append(m.template()).append('|');
        sb.append(String.join(SEP_ARG, m.args())).append('|');
        sb.append(m.sentAt()).append('|');
        sb.append(m.read() ? 1 : 0).append('|');
        sb.append(m.claimed() ? 1 : 0).append('|');
        sb.append(m.coins()).append('|');
        List<String> items = new ArrayList<>(m.items().size());
        for (ItemStack s : m.items()) {
            items.add(BuiltInRegistries.ITEM.getKey(s.getItem()) + "*" + s.getCount()
                    + "*" + s.getDamageValue());
        }
        sb.append(String.join(SEP_ITEM, items)).append('|');
        sb.append(m.action()).append('|');
        sb.append(MailService.daysLeft(m)).append('|');
        sb.append(MailService.isExpired(m) ? 1 : 0);
        return sb.toString();
    }
}
