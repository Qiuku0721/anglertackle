package com.whitecobalt.anglertackle.economy;

import com.whitecobalt.anglertackle.AnglersTackle;
import com.whitecobalt.anglertackle.fishing.Tuning;
import com.whitecobalt.anglertackle.mail.MailService;
import com.whitecobalt.anglertackle.network.ModNetwork;
import com.whitecobalt.anglertackle.player.PlayerData;
import com.whitecobalt.anglertackle.player.PlayerFishingData;
import net.minecraft.ChatFormatting;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerPlayer;

import java.util.List;

/**
 * 图鉴完成度奖励。
 *
 * <p>口径（{@code docs/16} §④，数字采 {@code docs/03} §9.1）：
 * <b>完成度 = 已点亮鱼种数 / 全部鱼种；每点亮 {@value #SPECIES_PER_MILESTONE} 种发
 * {@value #COINS_PER_MILESTONE} 鱼币</b>。
 * 全收集（33 种）一共 16 个里程碑 = 800 鱼币。
 *
 * <h2>为什么必须幂等（而且是位掩码，不是一个"已发总数"）</h2>
 * 完成度只增不减，而奖励是在**每次上鱼**之后结算的。没有去重标记的话，
 * 每次上鱼都会把"已经达到"的所有里程碑再发一遍 —— 钓 100 条鱼就发 100 次 500 币，
 * 而界面上一切正常（余额变大了，谁会怀疑钱变多）。
 *
 * <p>文档里完全没写去重机制，这是实现时必须自己补的一环（同 {@code docs/16} §④）。
 * 用{@link PlayerFishingData#claimedMilestones()} 的位掩码而不是一个计数：
 * 计数只能表达"发了几个"，位掩码能表达"**具体哪几个**发过" ——
 * 以后里程碑改成"全收集额外奖励"这种不连续的档位时，计数型标记会立刻算错。
 *
 * <h2>为什么不放在 {@code PlayerFishingData.recordCatch} 里顺手发钱</h2>
 * 那个方法只该管数据（它自己也是这么注释的）。发钱要碰网络包（{@code syncCoins}）、
 * 要写聊天栏，这些都不是"改一条记录"该有的副作用。
 * 记账与发奖分开，两边各自可以单独测：记账错了看图鉴，发奖错了看余额。
 */
public final class CodexRewards {

    /**
     * 每点亮几种鱼算一个里程碑。
     *
     * <p>⚠ 这是**常量而不是配置项**：配置项数量被 {@code tools/check-config-parity.js}
     * 之类的检查锁死在 446 项，加一项要动 {@code Config.java} 的生成区，
     * 而这条数值目前没有任何调试需求（改它得连着文档一起改）。
     */
    private static final int SPECIES_PER_MILESTONE = 2;

    /** 每个里程碑发多少鱼币（{@code docs/03} §9.1 的现成数字）。 */
    private static final long COINS_PER_MILESTONE = 50L;

    /**
     * 最多认多少个里程碑。
     *
     * <p>{@code claimedMilestones} 是 int 位掩码，第 31 位是符号位，
     * 所以最多只能用低 30 位。用超了会写成负数，而负数的位掩码
     * 表现是"所有位看起来都置上了"—— 那是"奖励再也不发"的静默故障。
     *
     * <p>⚠ 2026-10-08 从 15 抬到 25：**15 只能覆盖 30 种鱼，而第 1 批加完已经 33 种** ——
     * 也就是说第 31~33 种鱼点亮时**一个鱼币都不发**，而且没有任何报错。
     * 25 = 50 种鱼，为后面几批（极地 10 + 远洋 5）留足余量，离符号位还有 5 位。
     */
    private static final int MAX_MILESTONES = 25;

    private CodexRewards() {
    }

    /**
     * 上鱼之后结算里程碑奖励。**幂等**：同一个里程碑只会发一次。
     *
     * <p>调用点在 {@code FishingManager.onCatch} 的图鉴记账**之后** ——
     * 顺序反了会永远晚一条鱼发奖（发奖读的就是刚写进去的完成度）。
     *
     * @return 这次实际发出去的鱼币（0 = 没有新里程碑）
     */
    public static long grantMilestones(ServerPlayer player) {
        // ---- 第一趟只读：绝大多数上鱼走的就是"没有新里程碑"这条路 ----
        //
        // 为什么不在 update 里顺手判断：附件是**不可变 record**，每次 update 都是
        // 一次 setData = 把附件标脏 = 下次存档多写一份 NBT。钓一条鱼就写一次玩家数据
        // 完全没必要，所以先用一次纯读挡掉。
        PlayerFishingData before = PlayerData.get(player);
        if (!hasPending(before)) {
            return 0L;
        }

        // ---- 2026-10-12 M4 改造：奖励改成**寄信**（`docs/36` §4.1 第 3 条）----
        //
        // 原话："现在直接进钱包 ⇒ 改成发信，玩家**知道**这 50 币是哪来的"。
        //
        // ⚠⚠ 顺序是这一段的关键：**先投递、后置位**。
        //   位掩码 claimedMilestones 是这道奖励的**唯一去重**；要是先把位标上、
        //   再发现邮箱满了（`MailService.send` 会拒绝投递），那笔钱就**永久拿不到**，
        //   而且不报错 ✗。所以满箱时**不置位**、给玩家一句话，下次上鱼自动重试 ✓。
        int reached = milestonesReached(before.codexCount());
        int pending = 0;
        for (int i = 0; i < reached; i++) {
            if (!before.hasClaimed(i)) {
                pending++;
            }
        }
        long coins = pending * COINS_PER_MILESTONE;
        MailService.Result sent = MailService.deliver(player, "codex_milestone",
                List.of(String.valueOf(pending), String.valueOf(coins),
                        String.valueOf(before.codexCount())),
                coins, List.of());
        if (sent != MailService.Result.OK) {
            // 邮箱满 ⇒ 这一趟什么都不做（**不置位** ⇒ 奖励没丢，清出格子后下次上鱼再发）
            player.sendSystemMessage(Component.translatable(
                    "message.anglertackle.codex_milestone_full",
                    Tuning.mailMaxMails()).withStyle(ChatFormatting.RED));
            AnglersTackle.LOGGER.warn("[垂纶] 图鉴里程碑：{} 的邮箱满了（上限 {}），"
                            + "{} 鱼币的奖励**没有置位**、下次上鱼会重试",
                    player.getName().getString(), Tuning.mailMaxMails(), coins);
            return 0L;
        }

        // ---- 投递成功 ⇒ 置位（**不加币**：币在邮件附件里，玩家去邮箱领）----
        PlayerData.update(player, d -> {
            PlayerFishingData next = d;
            for (int i = 0; i < reached; i++) {
                if (!next.hasClaimed(i)) {
                    next = next.markClaimed(i);
                }
            }
            return next;
        });
        AnglersTackle.LOGGER.info("[垂纶] 图鉴里程碑：+{} 个（已点亮 {} 种 / 共 {} 种），"
                        + "{} 鱼币**已寄到邮箱**（玩家领取才入账）",
                pending, before.codexCount(),
                com.whitecobalt.anglertackle.fishing.FishSpecies.ALL.size(), coins);
        return coins;
    }

    /**
     * 已点亮 {@code collected} 种鱼时**应该**拿到的里程碑数（含已经领过的）。
     *
     * <p>写成 public 是为了让"完成度 → 奖励"这条换算只有一个出处：
     * 以后要在界面上显示"下一个里程碑还差几种"时直接问这里，
     * 不要各自再算一遍（两处各算一遍必然漂移）。
     */
    public static int milestonesReached(int collected) {
        return Math.min(MAX_MILESTONES, Math.max(0, collected) / SPECIES_PER_MILESTONE);
    }

    /** 还有没有"已经达成但没领"的里程碑。 */
    private static boolean hasPending(PlayerFishingData data) {
        int reached = milestonesReached(data.codexCount());
        for (int i = 0; i < reached; i++) {
            if (!data.hasClaimed(i)) {
                return true;
            }
        }
        return false;
    }
}
