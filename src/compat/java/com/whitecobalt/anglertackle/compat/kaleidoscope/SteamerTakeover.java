package com.whitecobalt.anglertackle.compat.kaleidoscope;

import com.github.ysbbbbbb.kaleidoscopecookery.blockentity.kitchen.SteamerBlockEntity;
import com.whitecobalt.anglertackle.fishing.FishChunkData;
import com.whitecobalt.anglertackle.registry.ModDataComponents;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.Level;
import net.neoforged.neoforge.event.entity.player.PlayerInteractEvent;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * 蒸笼数据保真（清蒸鱼那条线）。
 *
 * <h2>他们的蒸笼怎么玩（用户 2026-10-04 说明）</h2>
 * 把物品**放进去** → 熟了成品就在方块里 → **空手右键取出**。
 * 两次交互都是方块右键，所以两边我们都能看见：
 * <pre>
 *   放料（手里拿着整鱼）→ 把"这条鱼"记在我们自己的小表里（他们**没有**公开的"里面是什么"读取口，
 *                        {@code SteamerBlockEntity} 只暴露进度/时间的 int[]）
 *   取出（空手右键）    → 先记快照、取消他们的逻辑、代跑 {@code takeFood}，
 *                        再把刚出现的那一份**就地换成带数据的**
 * </pre>
 *
 * <h2>数据从哪来</h2>
 * 与汤锅同一套：放料时记、取出时按坐标取回（{@link StockpotTakeover#remember}）。
 * 之所以不读方块：他们没给读的口子 —— 不猜、不反射，只用自己的记录。
 */
final class SteamerTakeover {

    private static final Logger LOGGER = LoggerFactory.getLogger("AnglerTackle/Kaleidoscope");

    private static int debugLeft = 8;

    private SteamerTakeover() {
    }

    private static void debug(String msg) {
        if (debugLeft-- > 0) {
            LOGGER.info("垂纶／蒸笼：{}", msg);
        }
    }

    static void onRightClickBlock(PlayerInteractEvent.RightClickBlock event) {
        try {
            apply(event);
        } catch (Throwable t) {
            // 与汤锅/炒锅同一条底线：兼容层出错只能退化成"这道菜没数据"，绝不允许弄崩游戏
            LOGGER.warn("垂纶：蒸笼数据保真跳过（{}）", t.toString());
        }
    }

    /** 笼里有没有"已经熟了"的那一格（他们公开的 int[] 数组；time>0 才是有效格）。 */
    private static boolean hasCookedSlot(SteamerBlockEntity steamer) {
        int[] progress = steamer.getCookingProgress();
        int[] time = steamer.getCookingTime();
        if (progress == null || time == null) {
            return false;
        }
        for (int i = 0; i < Math.min(progress.length, time.length); i++) {
            if (time[i] > 0 && progress[i] >= time[i]) {
                return true;
            }
        }
        return false;
    }

    private static void apply(PlayerInteractEvent.RightClickBlock event) {
        Level level = event.getLevel();
        if (!(level.getBlockEntity(event.getPos()) instanceof SteamerBlockEntity steamer)) {
            return;
        }
        if (level.isClientSide()) {
            return;
        }
        var player = event.getEntity();
        ItemStack held = event.getItemStack();
        var pos = event.getPos();

        // ⚠⚠ 他们的笼盖是 **shift+右键** 开关的（用户 2026-10-04 说明）。
        //   上一版不判潜行，于是"开关笼盖"也被我们抢走 —— 表现就是"一放我们的鱼，
        //   右键无论如何都把蒸笼搞坏"。潜行的一律不碰。
        if (player.isSecondaryUseActive()) {
            return;
        }

        // ① 放料：手里是整鱼/鱼块 → 记下"这一笼蒸的是哪条鱼"
        if (!held.isEmpty()) {
            FishChunkData data = StockpotTakeover.dataOf(held);
            if (data != null) {
                StockpotTakeover.remember(level, pos, data);
                debug("放料：记住 " + data.speciesId() + " 档位 " + data.tier() + "（" + held.getItem() + "）");
            }
            return;                                   // 放料本身交给他们
        }

        // ② 空手右键 = 取出：把成品换成带数据的。
        //    ⚠ 1.5.1 我按"progress >= time 才算熟"来判断，结果一次都没进到取出分支
        //      （日志里只有"放料：记住…"，没有取出记录）—— 对他们那两个 int[] 的语义是猜的。
        //      现在**不猜**：不潜行 + 空手 + 我们记过这条鱼 就代跑 takeFood；
        //      他们要是说"取不出来"（返回 false），我们把 canceled 撤回，原样交给他们。
        FishChunkData use = StockpotTakeover.recall(level, pos);
        if (use == null) {
            return;                                   // 不是我们蒸的东西 → 一个字都不改
        }
        debug("空手右键：progress=" + java.util.Arrays.toString(steamer.getCookingProgress())
            + " time=" + java.util.Arrays.toString(steamer.getCookingTime())
            + " 熟格判断=" + hasCookedSlot(steamer));
        ItemStack[] before = Reclaim.snapshot(player);
        event.setCanceled(true);                      // 他们的取出由我们代跑（防两次取出）
        if (!steamer.takeFood(level, player)) {
            event.setCanceled(false);                 // 他们自己来
            return;
        }
        if (Reclaim.swapLatest(level, player, pos, before, use)) {
            StockpotTakeover.forget(level, pos);
            debug("取出替换成功：" + use.speciesId() + " 档位 " + use.tier());
        } else {
            debug("取出替换失败：找不到刚出现的那一份（玩家拿到无数据版）");
        }
    }
}
