package com.whitecobalt.anglertackle.achievement;

import com.whitecobalt.anglertackle.fishing.FishSpecies;
import com.whitecobalt.anglertackle.mail.MailService;
import com.whitecobalt.anglertackle.player.AchievementData;
import com.whitecobalt.anglertackle.player.FishermanData;
import com.whitecobalt.anglertackle.player.PlayerData;
import com.whitecobalt.anglertackle.title.Titles;
import com.whitecobalt.anglertackle.player.PlayerFishingData;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerPlayer;

import java.util.List;

/**
 * 成就的**唯一结算点**（策划 `docs/41` §7 A1）。
 *
 * <h2>为什么只有一个入口</h2>
 * 与委托的 `settleReached` 同一条纪律：玩家可能
 * ① 这次上鱼刚好达标；② 上次达标时**邮箱满**、奖励没发出去；③ 服务器重启后附件里躺着一条
 * "该点亮但没发奖"的记录。三条都要能补上 ⇒ 只留 {@link #unlock} 一个入口，
 * 调用方（A2 的 `LeaderboardHooks.onLanded`、A3 的其它系统、以及 OP 调试指令）都走它。
 * 两份逻辑迟早不一致，本仓库已经吃过这个亏。
 *
 * <h2>幂等的三道</h2>
 * <ol>
 *   <li>{@link AchievementData#has} —— 已点亮 ⇒ 直接返回（**不重复发信**）；</li>
 *   <li>{@link AchievementData#withUnlocked} —— 本身幂等（已点亮原样返回）；</li>
 *   <li>**先发信、成功才置位** —— 邮箱满时 {@link MailService#deliver} 返回
 *       {@link MailService.Result#BOX_FULL}，此时**不置位**，等玩家清出邮箱后下次触发补发。
 *       （反过来写就是"置了位但信没发出去" ⇒ 玩家永远拿不到奖励，而且看起来完全正常 ✗）</li>
 * </ol>
 *
 * <h2>本阶段的范围</h2>
 * A1 做"**手动触发一条 ⇒ 邮箱收到《成就达成》且可领取**"这条验收链；
 * **A2 已接上鱼类 11 条的自动达成**（{@link #onCatch}，由 {@code LeaderboardHooks.onLanded}
 * 一行接线）—— 后续类别（纪录 / 技法 / 环境 / 等级 / 联赛 / 料理 / 水族 / 商店 / 任务）
 * 按 `docs/41` §7 逐阶段接进来，**都走本入口**。
 * 原版 advancement 的广播（路线 C 的"白拿 Toast"）尚未接，见交接文档的妥协项。
 */
public final class AchievementService {

    private AchievementService() {
    }

    /** 达成信的模板 id（语言键 `mail.anglertackle.achievement_done.title|body`）。 */
    public static final String MAIL_DONE = "achievement_done";

    /** 成就名的语言键前缀（`achievement.anglertackle.<id>`）。 */
    public static final String NAME_PREFIX = "achievement.anglertackle.";

    // ---------------------------------------------------------------- A2：上鱼类判定
    /**
     * 品质档位口径（`docs/41` §4.2 与 {@code FishSpecies} 第 91 行**逐字一致**，
     * 0 起算）：白0 绿1 蓝2 紫3 金4 红5。
     *
     * <p>⚠ 只在这里写一遍：判定（{@link #onCatch}）与将来任何"按档位"的显示都读它 ——
     * 出现第二份口径的那天，就是"初见金点成了初见紫"的那天。
     */
    private static final int TIER_GREEN = 1;
    private static final int TIER_BLUE = 2;
    private static final int TIER_PURPLE = 3;
    private static final int TIER_GOLD = 4;
    private static final int TIER_RED = 5;

    /** 图鉴里程碑（`docs/41` §4.1 #2~#5：5 / 10 / 24 / 40 种；"全部"单独算，见 onCatch）。 */
    private static final int[] CODEX_MILESTONES = {5, 10, 24, 40};

    /**
     * 点亮一个成就并发一封达成信（**唯一入口、幂等**）。
     *
     * @return true = 这一次真的点亮了（调用方可据此打日志/做后续表现）；
     *         false = 已点亮、id 不认识、或邮箱满（**邮箱满不算达成**，下次补发）
     */
    /**
     * **等级类成就**（`docs/41` §7 A3）：由 {@code FishermanData.addXp} 在**升级那一刻**调一次
     * （那是全仓库唯一的经验入口，所以这里也是唯一要接的钩子）✓。
     *
     * <p>门槛与既有称号 `angler_10 / angler_21 / angler_31` **逐字一致** —— 同条件的成就
     * 走 A5 那条映射去授予既有称号，**不新增称号**（`docs/41` §9）。
     *
     * <p>幂等由 {@link #unlock} 保证：重复升级不会重复发信 ✓。
     */
    public static void syncLevel(ServerPlayer player, int level) {
        if (player == null) {
            return;
        }
        // 门槛照策划 §4 第 20~24 条：10 / **21** / **31** / 40 / 50（与 angler_10/21/31/40/50 逐字对齐）
        if (level >= 10) {
            unlock(player, "d_lv10");
        }
        if (level >= 21) {
            unlock(player, "d_lv20");
        }
        if (level >= 31) {
            unlock(player, "d_lv30");
        }
        if (level >= 40) {
            unlock(player, "d_lv40");
        }
        if (level >= 50) {
            unlock(player, "d_lv50");
        }
    }

    /**
     * **尺寸类成就**（`docs/41` §4 第 14~18 条）：由 {@code LeaderboardHooks.onLanded} 在上鱼那一刻
     * 多调一次（kg/cm 就在手边，**不另存进度** —— 存一份就是第二份真源）。
     *
     * <p>门槛照策划：1kg / 5kg / 10kg / 50cm / 100cm；与既有称号 `giant_5` 同条件的那条
     * 走 A5 映射去授予既有称号 ✓。
     */
    /**
     * **计数类成就**（`docs/41` §4 的 `e_*` / `f_*` / `i_*` / `k_*` 里"能从既有计数读出来"的那些）。
     *
     * <h2>为什么只读、不自己记</h2>
     * 打窝次数（`Titles.K_CHUM`）、满月尾数（`K_FULL_MOON`）、联赛参赛（`K_LEAGUE_JOINED`）、
     * 委托累计与周活跃（`QuestData.totalCompleted` / `activity`）**都已经有真源**。
     * 成就这边再记一份 = 第二份真源，迟早出现"称号说 100 次、成就说 99 次" ✗。
     * ⇒ 这里只**读**，谁的计数谁 bump（与 `PlayerTitles.progress` 那条纪律同源）。
     *
     * <p>调用时机：登录时（`FirstJoinEvents`，紧跟 `Titles.syncAuto`）与上鱼时
     * （`LeaderboardHooks`）—— 覆盖"玩家下次进游戏就能补上"这条底线 ✓。
     */
    /**
     * **天时地利类**（`docs/41` §4 的 `i_*`）：上鱼那一刻天气 / 群系就在手上，**当场判、不存计数** ——
     * 存一份"上次是什么天气"就是第二份真源，而且永远说不清"到底算不算数" ✓。
     *
     * <p>调用时机：仅 {@code LeaderboardHooks.onLanded}（鱼上岸那一刻）。
     */
    public static void syncEnvironment(ServerPlayer player) {
        if (player == null) {
            return;
        }
        try {
            if (player.level().isRaining()) {
                unlock(player, "i_rain");
            }
            // 老地方（策划 §4 第 46 条"在渔夫小屋/营地附近钓到鱼"）：
            // ⚠ 用户 2026-10-15 指了条更好的路 —— **不判结构、判老柯**：老柯（`FishermanEntity`）
            //   不移动，而且**只会出现在渔夫小屋**，所以他附近 ≡ 小屋附近，还免掉"结构搜索半径 1200 格"
            //   那套又慢又难判的活 ✓。半径取 24 格（一个码头 + 屋前空地的量级）。
            if (!player.level().getEntitiesOfClass(
                    com.whitecobalt.anglertackle.entity.FishermanEntity.class,
                    player.getBoundingBox().inflate(24.0)).isEmpty()) {
                unlock(player, "i_hut");
            }
        } catch (Throwable ignored) {
            // 天气取不到就不发这条，绝不许影响玩法
        }
    }

    public static void syncCounters(ServerPlayer player) {
        if (player == null) {
            return;
        }
        try {
            if (Titles.progress(player, Titles.K_CHUM) >= 100) {
                unlock(player, "e_chum_100");
            }
            if (Titles.progress(player, Titles.K_FULL_MOON) >= 10) {
                unlock(player, "i_full_moon");
            }
            if (Titles.progress(player, Titles.K_LEAGUE_JOINED) >= 1) {
                unlock(player, "f_league_join");
            }
            // 极地渔者（策划 §4 第 45 条）：冷水域/冰钓的计数已有真源（`K_ICE`），只读不另记 ✓
            if (Titles.progress(player, Titles.K_ICE) >= 1) {
                unlock(player, "i_polar");
            }
            // 五十连上（策划 §4 第 29 条）：累计成功上鱼 50 次。计数真源 = `K_LAND`，
            // 由 `LeaderboardHooks.onLanded`（鱼上岸的唯一出口）bump，这里只读 ✓
            if (Titles.progress(player, Titles.K_LAND) >= 50) {
                unlock(player, "e_land_50");
            }
            // 鱼宴大厨（策划 §4 第 39 条）：`K_DISH_MADE` 是**菜型掩码**（`DishItem` 用 setBit
            // 按菜型 ordinal 置位），所以"做过 10 种菜型"= 数一数有几个 1 ✓ —— 门槛与既有称号
            // `chef_10` 对齐（策划 §8 第 2 条已定死 10 种）。
            if (Integer.bitCount(Titles.progress(player, Titles.K_DISH_MADE)) >= 10) {
                unlock(player, "g_dish_master");
            }
            // ── 2026-10-15 晚补满 50 条：以下全部**只读既有计数**（称号 K_* / 委托统计），
            //   没有新计数器、没有新钩子 —— 因为"每加一条都要先确认真源"是这轮的铁律 ✓ ──
            if (Titles.progress(player, Titles.K_RED) >= 10) {
                unlock(player, "b_red_10");
            }
            if (Titles.progress(player, Titles.K_NIGHT) >= 10) {
                unlock(player, "i_night_10");
            }
            if (Titles.progress(player, Titles.K_STORM_GOLD) >= 1) {
                unlock(player, "i_storm");
            }
            if (Titles.progress(player, Titles.K_ICE) >= 5) {
                unlock(player, "i_ice_5");
            }
            if (Titles.progress(player, Titles.K_FULL_MOON) >= 50) {
                unlock(player, "i_full_moon_50");
            }
            if (Titles.progress(player, Titles.K_LINE_BREAK) >= 10) {
                unlock(player, "e_line_break_10");
            }
            if (Titles.progress(player, Titles.K_LAND) >= 200) {
                unlock(player, "e_land_200");
            }
            if (Titles.progress(player, Titles.K_CHUM) >= 500) {
                unlock(player, "e_chum_500");
            }
            // ⚠ 这两条**就地取**委托数据：本方法是"一串只读检查"，`var quests` 声明在这段之后 ——
            //   引用它会让编译失败（2026-10-15 晚真踩了一次）。就地取一次，语义一样、顺序不再敏感 ✓。
            if (com.whitecobalt.anglertackle.player.PlayerData.getQuests(player).totalCompleted() >= 30) {
                unlock(player, "k_daily_30");
            }
            if (com.whitecobalt.anglertackle.player.PlayerData.getQuests(player).activity() >= 50) {
                unlock(player, "k_activity_50");
            }
            // 开火 / 一刀鲜（策划 §4 第 36、37 条）：`K_DISH_MADE` 的位 = `DishRecipe.Dish` 的 ordinal
            //   （0 BRAISED … 7 BALL、**8 SASHIMI**、9 DEEP_FRIED）。所以：
            //   一刀鲜 = 第 8 位被置过；开火 = **除刺身外**任一位（即"第一次把鱼做熟"）✓。
            //   ⚠ 策划写的是"首次烤鱼"，而枚举里没有单独的"烤" —— 取"第一次开火做熟"这个更宽、
            //     也不会误判的口径（刺身是生食，不算开火）✓。
            int dishMask = Titles.progress(player, Titles.K_DISH_MADE);
            if ((dishMask & (1 << 8)) != 0) {
                unlock(player, "g_first_sashimi");
            }
            if ((dishMask & ~(1 << 8)) != 0) {
                unlock(player, "g_first_grill");
            }
            var quests = com.whitecobalt.anglertackle.player.PlayerData.getQuests(player);
            if (quests.totalCompleted() >= 1) {
                unlock(player, "k_first_daily");
            }
            if (quests.activity() >= 100) {
                unlock(player, "k_activity_full");
            }
        } catch (Throwable ignored) {
            // 读计数失败绝不许影响玩法（与其它成就钩子同一条纪律）
        }
    }

    public static void syncSize(ServerPlayer player, double kg, double cm) {
        if (player == null) {
            return;
        }
        if (kg >= 1.0) {
            unlock(player, "c_1kg");
        }
        if (kg >= 5.0) {
            unlock(player, "c_5kg");
        }
        if (kg >= 10.0) {
            unlock(player, "c_10kg");
        }
        if (cm >= 50.0) {
            unlock(player, "c_50cm");
        }
        if (cm >= 100.0) {
            unlock(player, "c_100cm");
        }
        // 传奇尺寸（2026-10-15 晚补满 50 条）：同样"这一杆的 kg/cm 当场判"，不存进度 ✓
        if (kg >= 20.0) {
            unlock(player, "c_20kg");
        }
        if (cm >= 150.0) {
            unlock(player, "c_150cm");
        }
    }

    public static boolean unlock(ServerPlayer player, String id) {
        if (player == null) {
            return false;
        }
        AchievementDef.Def def = AchievementDef.byId(id);
        if (def == null) {
            return false;                       // 不认识的 id 不猜、不兜底
        }
        AchievementData cur = PlayerData.getAchievements(player);
        if (cur.has(id)) {
            return false;                       // 幂等第一道：已点亮 ⇒ 什么都不做
        }
        // 信件正文用"成就名"当参数；服务端取本地化文本（与 Titles.grant 报消息同一手法）。
        String name = Component.translatable(NAME_PREFIX + id).getString();
        // ⚠ 连带改动（用户 2026-10-15 进游戏验收时点出来的）：**达成同时授予的称号必须写进信里** ——
        //   原先称号是 `Titles.grant` 静默授予的，玩家在信里只看到鱼币，会以为"说好的称号呢"。
        //   称号名走既有的公开入口 `Titles.nameKey(id)`（与称号面板同源，不会拼错键）✓。
        String mailTitleId = AchievementDef.titleFor(id);
        String titleLine = mailTitleId == null ? "" : Component.translatable(
                "mail.anglertackle.achievement_done.with_title",
                Component.translatable(Titles.nameKey(mailTitleId)).getString()).getString();
        // ⚠ **只传一个参数**：邮件存的是"模板 + 参数"、**读信时**才用当前语言文件渲染
        //   ⇒ 正文的 `%s` 个数一旦和参数个数不一致，格式化整体失败，整句会原样显示 `%s`
        //   （2026-10-15 用户截图抓到：我把正文改成 2 个 `%s`，而他邮箱里那封旧信只有 1 个参数 ✗）。
        //   所以"称号那行"并进**同一个参数**里 —— 旧信新信都能正常渲染 ✓。
        String body = Component.translatable("mail.anglertackle.achievement_done.line", name).getString()
                + titleLine;
        if (MailService.deliver(player, MAIL_DONE, List.of(body), def.coins(), List.of())
                != MailService.Result.OK) {
            return false;                       // 邮箱满 ⇒ 不置位，留到下次补发 ✓
        }
        PlayerData.setAchievements(player, cur.withUnlocked(id));
        // 经验也走既有系统（不新造通道）；鱼币已在信的附件里 ⇒ 玩家领取时入包。
        FishermanData.addXp(player, def.xp());
        // A5（docs/41 §9）：与既有称号**同条件**的成就，只调 `Titles.grant` 授予那个**既有**称号，
        // **不新增称号** ✓。两处纪律：
        //   ① 放在"发信成功 + 已置位"**之后** ⇒ 重复触发根本走不到这里（幂等第一道已经 return 了）；
        //   ② 授予入口只有 `Titles.grant` 一处（绝不自己写 `owned.add`，否则绕过首授提示与服务端日志），
        //      而且不可重复称号在 grant 里有"已拥有 ⇒ 不 +1"那道闸（§9.6 第 3 条，2026-10-15 已加固）✓。
        String titleId = AchievementDef.titleFor(id);
        if (titleId != null) {
            Titles.grant(player, titleId);
        }
        return true;
    }

    /**
     * 上鱼成功时调一次（由 {@code LeaderboardHooks.onLanded} 接线，**服务端**）✓ —— A2 自动达成。
     *
     * <h2>为什么判定放在这里，而不是挂在 {@code LeaderboardHooks} 里</h2>
     * 那个挂钩点是**大家共用的**（图鉴记账 / 排行榜 / 称号 / 联赛 / 比赛 / 委托都按顺序挂在
     * 同一行后面），往里写判断就会出现"两条逻辑迟早不一致"—— 而这里每条成就只是
     * **一个条件 + 一行 {@code unlock}**，全部走唯一结算点 {@link #unlock}（幂等三道照旧）✓。
     *
     * <h2>⚠ 图鉴种数必须自己 +1（本方法最贵的一个细节）</h2>
     * {@code PlayerFishingData.recordCatch} 发生在 LANDING 走完之后的 {@code FishingManager}，
     * 比本方法**晚**；所以"这一杆刚好点亮第 5 种"时 {@code codexCount()} 还是 4 ——
     * 不补这个 +1，里程碑成就**永远差一条鱼**，而且只在凑满那一杆差，极难复现 ✗。
     * （反过来，老档"差几条才满"的状态由每次调用都重算覆盖到，不需要额外补登。）
     *
     * <h2>本阶段的范围（A2 = 上鱼类 11 条，`docs/41` §4.1 + §4.2）</h2>
     * 纪录（§4.3 的重量/体长）、技法、环境等类别**不在这里**：它们的阈值形状不同
     * （而且部分要等别的挂钩点），按 §7 逐阶段加，每批都配检查器断言 + 负例。
     */
    public static void onCatch(ServerPlayer player, String fishId, double kg, double cm, int tier) {
        if (player == null) {
            return;
        }
        // 成就是纯加法：任何异常都不许影响上鱼（抄 LeaderboardHooks 的成例 ✓）
        try {
            PlayerFishingData fd = PlayerData.get(player);
            boolean newSpecies = fishId != null && !fishId.isEmpty() && !fd.hasCaught(fishId);
            int codexAfter = fd.codexCount() + (newSpecies ? 1 : 0);

            // ① 开竿（§4.1 #1）：钓到第一条鱼。每次调用都意味着"这一杆钓到了"，
            //    所以第一次调用即点亮；老存档同理在下次上鱼时补发
            //    （与 CodexRewards 里程碑"不设门槛"同一口径 ✓）。
            if (codexAfter >= 1) {
                unlock(player, "a_first_catch");
            }
            // ② 图鉴里程碑（§4.1 #2~#5）。
            for (int n : CODEX_MILESTONES) {
                if (codexAfter >= n) {
                    unlock(player, "a_codex_" + n);
                }
            }
            // ③ 鱼类通鉴（§4.1 #6）：全部鱼种。总数只认 FishSpecies.ALL（真源），
            //    不在这里写死 47 —— 写死了将来加鱼就得改两处。
            if (codexAfter >= FishSpecies.ALL.size()) {
                unlock(player, "a_codex_all");
            }
            // ④ 品质初见（§4.2 #9~#13）：按档位常量判，口径见 TIER_* 的注释。
            switch (tier) {
                case TIER_GREEN -> unlock(player, "b_green");
                case TIER_BLUE -> unlock(player, "b_blue");
                case TIER_PURPLE -> unlock(player, "b_purple");
                case TIER_GOLD -> unlock(player, "b_gold");
                case TIER_RED -> unlock(player, "b_red");
                default -> { }   // 白档（0）与未知（-1）没有对应成就
            }
        } catch (Throwable ignored) {
            // 同上：成就坏了也不许让鱼跑掉 ✓
        }
    }

    /**
     * 已点亮的条数（界面用）。
     *
     * <p>**故意不在服务里缓存**：附件就是真源，缓存一份迟早不一致
     * （"面板说 12 条、点开只有 11 条"这类 bug 最难查）。
     */
    public static int unlockedCount(ServerPlayer player) {
        return player == null ? 0 : PlayerData.getAchievements(player).count();
    }
}
