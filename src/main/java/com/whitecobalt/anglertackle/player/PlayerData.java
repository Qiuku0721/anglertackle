package com.whitecobalt.anglertackle.player;

import com.whitecobalt.anglertackle.registry.ModAttachments;
import net.minecraft.world.entity.player.Player;

import java.util.function.UnaryOperator;

/**
 * 读写玩家附件的唯一入口。
 *
 * <p>为什么要包一层：{@code getData} / {@code setData} 分散在几十处调用点时，
 * 很容易写出"改了对象但忘了 setData 回去"——而 {link PlayerFishingData} 是
 * 不可变 record，那种写法**编译能过、运行不报错、数据就是不变**，
 * 表现为"钱加了但一重启就没了"。统一走 {@link #update} 就不可能忘。
 *
 * <p>服务端权威：只在服务端调用。客户端要显示鱼币/图鉴时由服务端下发。
 */
public final class PlayerData {

    private PlayerData() {
    }

    public static PlayerFishingData get(Player player) {
        return player.getData(ModAttachments.PLAYER_DATA);
    }

    public static void set(Player player, PlayerFishingData data) {
        player.setData(ModAttachments.PLAYER_DATA, data);
    }

    /** 读 → 改 → 写回。所有修改都该走这里。 */
    public static PlayerFishingData update(Player player, UnaryOperator<PlayerFishingData> fn) {
        PlayerFishingData next = fn.apply(get(player));
        set(player, next);
        return next;
    }

    // ---------------------------------------------------------------- 称号（2026-10-11）
    //
    // 称号是**另一个附件**（PlayerTitles）—— 单开一组的理由见那个类的注释
    // （PlayerFishingData 的构造点太多，塞进去改一处忘一处就是"称号没存下来"）。
    // 这里同样只留一个"读 → 改 → 写回"的入口，避免"改了对象忘了 setData"那种静默失效。

    public static PlayerTitles getTitles(Player player) {
        return player.getData(ModAttachments.PLAYER_TITLES);
    }

    public static void setTitles(Player player, PlayerTitles titles) {
        player.setData(ModAttachments.PLAYER_TITLES, titles);
    }

    /** 称号的"读 → 改 → 写回"。 */
    public static PlayerTitles updateTitles(Player player, UnaryOperator<PlayerTitles> fn) {
        PlayerTitles next = fn.apply(getTitles(player));
        setTitles(player, next);
        return next;
    }

    // ---------------------------------------------------------------- 邮箱（2026-10-12）
    //
    // 第三个附件（MailBox）—— 与称号同理，理由见 ModAttachments 里那一段注释。
    // 这里同样只留"读 → 改 → 写回"的入口，避免"改了对象忘了 setData"那种静默失效
    // （症状只是"邮件领了但重启又有了"，很难当场发现）。

    public static MailBox getMails(Player player) {
        return player.getData(ModAttachments.PLAYER_MAILS);
    }

    public static void setMails(Player player, MailBox box) {
        player.setData(ModAttachments.PLAYER_MAILS, box);
    }

    /** 邮箱的"读 → 改 → 写回"。 */
    public static MailBox updateMails(Player player, UnaryOperator<MailBox> fn) {
        MailBox next = fn.apply(getMails(player));
        setMails(player, next);
        return next;
    }

    // ---------------------------------------------------------------- 委托（2026-10-14）
    //
    // 第四个附件（QuestData）—— 老柯的每日 / 周常任务进度（策划 docs/40）。
    // 单开的理由与邮箱 / 称号完全一致（PlayerFishingData 的构造点太多、委托是会增删的表）。
    // 同样只留这一个"读 → 改 → 写回"的入口，避免"改了对象忘了 setData"那种静默失效。

    public static QuestData getQuests(Player player) {
        return player.getData(ModAttachments.PLAYER_QUESTS);
    }

    public static void setQuests(Player player, QuestData quests) {
        player.setData(ModAttachments.PLAYER_QUESTS, quests);
    }

    /** 委托的"读 → 改 → 写回"。 */
    public static QuestData updateQuests(Player player, UnaryOperator<QuestData> fn) {
        QuestData next = fn.apply(getQuests(player));
        setQuests(player, next);
        return next;
    }

    // ---------------------------------------------------------------- 成就（docs/41 §7 A1）
    //
    // 单开的理由与邮箱 / 称号 / 委托完全一致（`PlayerFishingData` 的构造点太多）。
    // 同样只留这一个"读 → 改 → 写回"的入口，避免"改了对象忘了 setData"那种静默失效。

    public static AchievementData getAchievements(Player player) {
        return player.getData(ModAttachments.PLAYER_ACHIEVEMENTS);
    }

    public static void setAchievements(Player player, AchievementData achievements) {
        player.setData(ModAttachments.PLAYER_ACHIEVEMENTS, achievements);
    }

    /** 成就的"读 → 改 → 写回"。 */
    public static AchievementData updateAchievements(Player player, UnaryOperator<AchievementData> fn) {
        AchievementData next = fn.apply(getAchievements(player));
        setAchievements(player, next);
        return next;
    }
}
