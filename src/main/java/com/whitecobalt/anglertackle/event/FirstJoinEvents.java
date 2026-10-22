package com.whitecobalt.anglertackle.event;

import com.whitecobalt.anglertackle.AnglersTackle;
import com.whitecobalt.anglertackle.player.PlayerData;
import com.whitecobalt.anglertackle.player.PlayerFishingData;
import com.whitecobalt.anglertackle.registry.ModItems;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.item.ItemStack;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.EventBusSubscriber;
import net.neoforged.neoforge.event.entity.player.PlayerEvent;

/**
 * 第一次进游戏，自动发一本教程。
 *
 * <p>用户 2026-10-02："玩家第一次进入游戏后，自动获得一本教程。"
 *
 * <h2>为什么挂在"登录"而不是"首次合成"</h2>
 * 玩家进世界第一件事就是想知道"这模组怎么玩" —— 让他先去合成一本手册，
 * 等于要求他先知道有这个手册。所以登录即发。
 *
 * <h2>幂等靠存档里的标记，不靠内存</h2>
 * 标记是 {@link PlayerFishingData#guideGiven()}（玩家附件，跟着存档走）。
 * 用内存里的 Set 记的话，退出游戏再进就会再发一本 —— 而"每次登录都发一遍"
 * 只有玩到第二次才看得出来。
 *
 * <p>老存档里没有这个字段 → 默认 false → **老玩家下次登录也会补发一本**。
 * 这是有意的：1.1.0 的教程重写了（等级 1–50、评定材料、定位线索、附魔都变了），
 * 老玩家手里那本是旧的。
 */
@EventBusSubscriber(modid = AnglersTackle.MOD_ID)
public final class FirstJoinEvents {

    private FirstJoinEvents() {
    }

    @SubscribeEvent
    public static void onLogin(PlayerEvent.PlayerLoggedInEvent event) {
        if (!(event.getEntity() instanceof ServerPlayer player)) {
            return;
        }
        // ---- 称号「开服元老」：世界时间还在第 7 个游戏日之内就登录过 ----
        //
        // 判据以**世界累计时间**（totalTime，从 0 起算）为准，不是现实时间：
        // 它等价于"开服 7 天内"，而且不需要为它单开一份世界存档（少一份状态少一处漂移）✓。
        // ⚠ 与其它称号一样是**一次性**的（grant 幂等），所以放在登录事件里判最省 ——
        //   超过 7 天之后永远判不成立，不会有任何副作用。
        try {
            long now = player.level().getGameTime();
            if (now <= 7L * 24000L) {
                com.whitecobalt.anglertackle.title.Titles.grant(player, "old_guard");
            }
            com.whitecobalt.anglertackle.title.Titles.syncAuto(player);
            // 成就的计数类（docs/41 §4 的 e_/f_/i_/k_）：与称号同步同一时机、同一份只读计数 ——
            // 玩家下次进游戏就能把"其实早该拿到"的成就补上 ✓（幂等，重复登录不会重复发信）。
            com.whitecobalt.anglertackle.achievement.AchievementService.syncCounters(player);
        } catch (Throwable t) {
            AnglersTackle.LOGGER.warn("[垂纶] 登录时称号检查失败（已忽略）：{}", t.toString());
        }

        // ---- 邮件箱：过期作废附件 + 未读提示（用户 2026-10-11 点名要的邮件系统，docs/36）----
        //
        // ⚠ 必须放在下面那段 `guideGiven()` **早退之前** —— 那一段只对"第一次进游戏"生效，
        //   而邮件检查**每次登录**都要做（放过期、报未读）。放后面就会被早退挡掉 ✗。
        // ⚠ 未读提示**只提示一次**（就是登录这一下）—— 不是每 tick 弹动作栏（`docs/36` §6 的断言）。
        try {
            com.whitecobalt.anglertackle.mail.MailService.expireAttachments(player);
            // ⚠⚠ 2026-10-16 用户报的 bug："部分新存档不发教程"。
            //   查了游戏日志（`D:\mc\...\versions\1.21.1-NeoForge_21.1.250\logs\latest.log`）：
            //   投递**是成功的**（`[垂纶] 邮件投递：whitecobalt ← starter_kit#1（币 0 / 物品 1）`
            //   紧跟 `首次登录：已给 whitecobalt 一本教程（寄到邮箱）`），
            //   玩家侧也确实收到了那句聊天提示。所以问题不在"发没发"，而在**这条提示会漏看**：
            //   它是**聊天栏**的一行，几秒后被后面的话顶上去；玩家没注意到，
            //   就以为"没给教程"（包里没有、又不知道要去邮箱点【领取】）✗。
            //
            //   两道加固（都不改"礼包走邮件"这个设计）：
            //     ① 还没领的新手礼包**重新标成未读** ⇒ 下面那句未读提示每次登录都会再提一次，
            //        而且邮箱界面的行上会有 ● 待领 标记，直到他真的点开领走 ✓；
            //     ② 它出现时，用**动作栏**（准心上方、不会滚走）再说一遍怎么打开邮箱。
            com.whitecobalt.anglertackle.player.MailBox box =
                    com.whitecobalt.anglertackle.player.PlayerData.getMails(player);
            com.whitecobalt.anglertackle.player.MailBox nudged = box.withKitUnread();
            if (nudged != box) {
                com.whitecobalt.anglertackle.player.PlayerData.setMails(player, nudged);
            }
            if (unclaimedKit(player)) {
                player.displayClientMessage(Component.translatable(
                        "message.anglertackle.starter_kit_unclaimed"), true);
            }
            int unread = com.whitecobalt.anglertackle.mail.MailService.unread(player);
            if (unread > 0 && com.whitecobalt.anglertackle.fishing.Tuning.mailUnreadLoginNotice()) {
                player.displayClientMessage(Component.translatable(
                        "message.anglertackle.mail_unread_notice",
                        unread,
                        com.whitecobalt.anglertackle.mail.MailService.claimable(player)), false);
            }
        } catch (Throwable t) {
            AnglersTackle.LOGGER.warn("[垂纶] 登录时邮件检查失败（已忽略）：{}", t.toString());
        }

        // ---- 联赛（docs/37）：兑付离线期间攒下的邀请/成绩单/奖励 + 补发本期邀请 ----
        // ⚠ 同样必须在下面那段 `guideGiven()` 早退**之前**：那一段只对"第一次进游戏"生效，
        //   而离线兑付与补发邀请**每次登录**都要做 ✓
        try {
            com.whitecobalt.anglertackle.league.LeagueService.onLogin(player);
        } catch (Throwable t) {
            AnglersTackle.LOGGER.warn("[垂纶] 登录时联赛检查失败（已忽略）：{}", t.toString());
        }

        // ---- 比赛（docs/35）：兑付离线期间攒下的名次奖励（鱼币 + 冠军称号）----
        try {
            com.whitecobalt.anglertackle.contest.ContestService.onLogin(player);
        } catch (Throwable t) {
            AnglersTackle.LOGGER.warn("[垂纶] 登录时比赛检查失败（已忽略）：{}", t.toString());
        }

        PlayerFishingData data = PlayerData.get(player);
        if (data.guideGiven()) {
            return;
        }

        ItemStack book = new ItemStack(ModItems.GUIDE_BOOK.get());
        // ---- 2026-10-12 M4 改造：新手礼包改成**寄信**（`docs/36` §4.1 第 7 条）----
        //
        // 原话："现在直接塞背包（背包满就掉地上）⇒ 改成邮件，玩家点【领取】才入包"。
        //
        // ⚠⚠ `guideGiven` 这道幂等门的位置是这段的关键：**只有投递成功才置位**。
        //   置位在发信之前的话，发信失败（邮箱满）就永远拿不到手册 ✗；
        //   而把发信挪到 `guideGiven` 早退**之外**的话，每次登录都会再寄一本 ✗。
        //   邮箱也满（新玩家几乎不可能）⇒ 退回原行为：直接塞背包 / 掉在脚下，**东西不丢** ✓。
        boolean mailed = false;
        try {
            mailed = com.whitecobalt.anglertackle.mail.MailService.deliver(player, "starter_kit",
                    java.util.List.of(), 0L, java.util.List.of(book.copy()))
                    == com.whitecobalt.anglertackle.mail.MailService.Result.OK;
        } catch (Throwable t) {
            AnglersTackle.LOGGER.warn("[垂纶] 新手礼包寄信失败（改走直接塞背包）：{}", t.toString());
        }
        if (!mailed) {
            if (!player.getInventory().add(book)) {
                player.drop(book, false);   // 背包满（几乎不可能）就掉在脚下 —— 不能不发
            }
        }
        PlayerData.update(player, PlayerFishingData::withGuideGiven);
        player.displayClientMessage(Component.translatable(mailed
                ? "message.anglertackle.guide_mailed"
                : "message.anglertackle.guide_given"), false);
        AnglersTackle.LOGGER.info("[垂纶] 首次登录：已给 {} 一本教程（{}）",
                player.getName().getString(), mailed ? "寄到邮箱" : "直接进背包");
    }

    /**
     * 邮箱里还躺着一封**没领**的新手礼包吗？
     *
     * <p>判据只看模板 id 与 {@code claimed} —— 不看 id、不看时间，
     * 所以"礼包被领走"这件事一旦发生，这个方法就永远返回 false ✓。
     */
    private static boolean unclaimedKit(ServerPlayer player) {
        for (com.whitecobalt.anglertackle.player.MailEntry m
                : com.whitecobalt.anglertackle.player.PlayerData.getMails(player).mails()) {
            if ("starter_kit".equals(m.template()) && !m.claimed()) {
                return true;
            }
        }
        return false;
    }
}
