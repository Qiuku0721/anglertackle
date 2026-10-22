package com.whitecobalt.anglertackle.player;

import com.whitecobalt.anglertackle.registry.ModAttachments;
import net.minecraft.world.entity.player.Player;

/**
 * {@link FishermanProgress} 的读写入口 —— **全模组只允许从这里碰它**。
 *
 * <p>和 {@link PlayerData} 是同一个套路：把"唯一写入口"收在一个类里，
 * 这样以后要给等级变化加副作用（成就、播报、同步给客户端），
 * 只需要改这一个文件，不用去全仓库找 {@code setData}。
 */
public final class FishermanData {

    private FishermanData() {
    }

    public static FishermanProgress get(Player player) {
        return player.getData(ModAttachments.FISHERMAN.get());
    }

    /** **唯一的写入口**。 */
    public static void set(Player player, FishermanProgress data) {
        player.setData(ModAttachments.FISHERMAN.get(), data);
    }

    /** 按 {@code UnaryOperator} 改一次（最常见的形式）。 */
    public static void update(Player player, java.util.function.UnaryOperator<FishermanProgress> op) {
        set(player, op.apply(get(player)));
    }

    /** 商店开了没有：跟老柯说过第一句话之后才开。 */
    public static boolean shopOpen(Player player) {
        return get(player).talked();
    }

    /** 老柯的商店档位（1–5）——由垂纶等级推导。 */
    public static int stage(Player player) {
        return get(player).stage();
    }

    /** 当前垂纶等级（1–50）。 */
    public static int level(Player player) {
        return get(player).level();
    }

    /**
     * 给玩家加垂纶经验，返回这次升了几级。
     *
     * <p>卡在评定点（10/20/30/40）时**一点经验都不收** —— 规则在
     * {@link FishermanProgress#gainXp}，这里只负责写回。
     */
    public static int addXp(Player player, int amount) {
        FishermanProgress before = get(player);
        FishermanProgress.Gain g = before.gainXp(amount);
        if (!g.next().equals(before)) {
            set(player, g.next());
        }
        int gained = g.levelsGained();
        // A3（docs/41 §7）：升级那一刻顺手评估等级类成就。异常一律吞掉 ——
        // 成就只是锦上添花，**绝不许**因为发信失败把玩家的经验结算带崩（与称号同一条纪律）。
        if (gained > 0 && player instanceof net.minecraft.server.level.ServerPlayer sp) {
            try {
                com.whitecobalt.anglertackle.achievement.AchievementService.syncLevel(sp, g.next().level());
            } catch (Throwable ignored) {
                // 故意吞：见上
            }
        }
        return gained;
    }
}
