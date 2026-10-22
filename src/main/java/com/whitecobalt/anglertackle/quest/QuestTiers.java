package com.whitecobalt.anglertackle.quest;

/**
 * **活跃度四档奖励表**（用户 2026-10-14 原话："活跃度达到一定级别获得奖励，周活跃上限 100，
 * 奖励在 25,50,75,100 各发一种"）。
 *
 * <h2>为什么从 {@code QuestService} 搬到这里</h2>
 * 这组数原来写在 {@code QuestService}（服务端流程类，import 了 {@code ServerPlayer} /
 * {@code MailService}）里。1.6.4 用户验收时报"面板上只看得到活跃度进度，不知道各档给什么"，
 * 要在面板加悬浮提示 ⇒ 客户端一读 {@code QuestService} 就会把服务端类型牵进客户端
 * （正是 {@code QuestPayload} 注释里说的"ModNetwork 那次事故的形状"）。
 * 搬成**纯表**（和 {@link QuestPool} 同档：不碰任何服务端类型）之后：
 * 服务端结算（{@code QuestService.settleTiers}）与客户端悬浮提示（{@code QuestScreen}）
 * 读**同一份** ⇒ 口径只有一份 ✓。
 *
 * <p>⚠ 这一组数**只在这里写一遍**：位掩码的 bit 顺序 = 本数组下标
 * （{@code QuestData.tierClaimed(bit)}）⇒ 加档位只改这张表（数组长度就是档位数）✓。
 */
public final class QuestTiers {

    private QuestTiers() {
    }

    /** 活跃度档位（25 / 50 / 75 / 100）。 */
    public static final int[] AT = {25, 50, 75, 100};

    /** 四档的鱼币奖励（0 = 这一档给物品，见 {@link #ITEM}）。 */
    public static final long[] COINS = {200L, 0L, 0L, 0L};

    /** 四档的物品奖励 id（空串 = 这一档给鱼币）。 */
    public static final String[] ITEM = {"", "minecraft:iron_ingot", "anglertackle:bait_glow", "anglertackle:titanium_line"};

    /** 四档物品奖励的数量。 */
    public static final int[] ITEM_COUNT = {0, 4, 1, 1};

    /** 档位数（= {@code AT.length}）。 */
    public static int count() {
        return AT.length;
    }

    /** 这一档给鱼币吗（{@code COINS > 0}）。 */
    public static boolean givesCoins(int bit) {
        return bit >= 0 && bit < COINS.length && COINS[bit] > 0L;
    }

    /** 这一档给物品吗（id 非空）。 */
    public static boolean givesItem(int bit) {
        return bit >= 0 && bit < ITEM.length && !ITEM[bit].isEmpty();
    }
}
