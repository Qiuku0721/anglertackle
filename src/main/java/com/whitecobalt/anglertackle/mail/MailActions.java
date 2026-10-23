package com.whitecobalt.anglertackle.mail;

import com.whitecobalt.anglertackle.AnglersTackle;
import com.whitecobalt.anglertackle.league.LeagueService;
import com.whitecobalt.anglertackle.quest.QuestService;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerPlayer;

import java.util.Set;

/**
 * 邮件里的**动作按钮**（`docs/36` §4.2：`MailEntry.action` 是一个**服务端认识的动作 id**）。
 *
 * <h2>为什么单独一个类，而不是把联赛逻辑写进 {@code MailService}</h2>
 * 邮件箱是"通道"，联赛是"业务"：通道不该认识业务（否则以后每加一个用途都要改邮件系统，
 * 而邮件系统的四条纪律会被越改越松 ✗）。这里是一张**白名单表**：
 * 服务端只认表里的 id，客户端既不能自定义动作、也不能指定"替谁执行"
 * （与"玩家设置提交包不带 UUID"完全同一条纪律）。
 *
 * <h2>为什么"执行"放在领取成功之后</h2>
 * 点【签收】= 领签收礼 + 报名，**两件事都要发生**：先让 {@code MailService.claim} 把附件发完
 * （背包满时它会整封回滚 ⇒ 报名也不该发生 ✓），再跑这里。
 * 顺序反了就会出现"报了名但礼物没领到" ✗。
 */
public final class MailActions {

    /** 联赛签收（`docs/37` L3）：报名 + 领签收礼（礼由邮件附件给）。 */
    public static final String LEAGUE_JOIN = "league_join";

    /** 委托接取（`docs/40` §5）：把"今天/本周老柯派的活"记进玩家附件。 */
    public static final String QUEST_ACCEPT = "quest_accept";

    /** 白名单（只有这里列出来的动作会被执行）。 */
    private static final Set<String> KNOWN = Set.of(LEAGUE_JOIN, QUEST_ACCEPT);

    private MailActions() {
    }

    /** 服务端认识这个动作吗（不认识的**一律忽略**，不报错、不猜）。 */
    public static boolean known(String action) {
        return action != null && KNOWN.contains(action);
    }

    /**
     * 执行一个动作（领取成功之后调）。
     *
     * @return true = 真的执行了；false = 不认识的 id（已忽略）
     */
    public static boolean run(ServerPlayer player, String action) {
        if (!known(action)) {
            if (action != null && !action.isEmpty()) {
                AnglersTackle.LOGGER.warn("[垂纶] 邮件里出现未知动作 id「{}」，已忽略（白名单外的动作不执行）",
                        action);
            }
            return false;
        }
        if (LEAGUE_JOIN.equals(action)) {
            LeagueService.JoinResult r = LeagueService.joinSign(player);
            // 结果都告诉玩家 —— 不静默（"点了没反应"是最难查的一种）
            player.sendSystemMessage(Component.translatable(switch (r) {
                case OK -> "message.anglertackle.league_join_ok";
                case ALREADY -> "message.anglertackle.league_join_already";
                case TOO_LATE -> "message.anglertackle.league_join_too_late";
                case NOT_ELIGIBLE -> "message.anglertackle.league_join_not_eligible";
                case NO_PERIOD -> "message.anglertackle.league_join_no_period";
            }));
            return true;
        }
        if (QUEST_ACCEPT.equals(action)) {
            QuestService.Accept r = QuestService.acceptAll(player);
            // 结果都告诉玩家 —— 不静默（"点了没反应"是最难查的一种）
            player.sendSystemMessage(Component.translatable(switch (r) {
                case OK -> "message.anglertackle.quest_accept_ok";
                case ALREADY -> "message.anglertackle.quest_accept_already";
                case DISABLED -> "message.anglertackle.quest_accept_disabled";
                case NO_OFFER -> "message.anglertackle.quest_accept_no_offer";
            }));
            // 接下了就**顺手把面板打开**（用户 2026-10-14 要的"入口之一"）：
            // 玩家点完最想知道的就是"接下来去哪看、还差多少" —— 让他再去找指令是没道理的 ✓
            // （ALREADY 也开：那条路是"我又点了一次"，正好把他送到面板去 ✓）
            if (r == QuestService.Accept.OK || r == QuestService.Accept.ALREADY) {
                com.whitecobalt.anglertackle.network.ModNetwork.syncQuests(player, "");
            }
            return true;
        }
        return false;
    }
}
