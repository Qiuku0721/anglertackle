package com.whitecobalt.anglertackle.event;

import com.whitecobalt.anglertackle.AnglersTackle;
import com.whitecobalt.anglertackle.fishing.FishingManager;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.EventBusSubscriber;
import net.neoforged.neoforge.event.entity.player.PlayerEvent;
import net.neoforged.neoforge.event.server.ServerStoppedEvent;
import net.neoforged.neoforge.event.tick.LevelTickEvent;

/**
 * 服务端事件。
 *
 * <p>会话推进挂在 {@code LevelTickEvent.Post} 上而不是玩家/实体 tick：
 * 只在**有活跃会话**时才有开销（没有会话时是一次 isEmpty 判断），
 * 避免和别的模组抢 tick（docs/09-原版冲突与渲染优化.md §2 第 6 条）。
 */
@EventBusSubscriber(modid = AnglersTackle.MOD_ID)
public final class ServerEvents {

    private ServerEvents() {
    }

    @SubscribeEvent
    public static void onLevelTick(LevelTickEvent.Post event) {
        if (event.getLevel() instanceof ServerLevel serverLevel) {
            // 只有主世界推进会话（跨维度会结束会话）
            if (serverLevel.dimension() == net.minecraft.world.level.Level.OVERWORLD) {
                FishingManager.get().tick(serverLevel);
                // 窝子：到期清理 + 批量低频粒子（docs/05-世界与钓点.md §4.3）
                com.whitecobalt.anglertackle.fishing.ChumManager.get().tick(serverLevel);
                // 联赛：开期 / 硬截止结算的周期检查（**内部按 20 tick 节流**，见 LeagueService.CHECK_INTERVAL）
                // ⚠ 一行接线：想摘掉联赛，删掉这一行 + league 包即可，玩法回到现在逐字一致 ✓
                com.whitecobalt.anglertackle.league.LeagueService.tick(serverLevel.getServer());
                // 比赛：到点结束 / 自动开赛的周期检查（同样 20 tick 节流，见 ContestService.CHECK_INTERVAL）
                com.whitecobalt.anglertackle.contest.ContestService.tick(serverLevel.getServer());
            }
        }
    }

    /** 玩家登出/换维度：立刻清场，避免浮漂留在世界里。 */
    @SubscribeEvent
    public static void onPlayerLoggedOut(PlayerEvent.PlayerLoggedOutEvent event) {
        if (event.getEntity() instanceof ServerPlayer player) {
            FishingManager.get().forget(player);
        }
    }

    @SubscribeEvent
    public static void onPlayerChangedDimension(PlayerEvent.PlayerChangedDimensionEvent event) {
        if (event.getEntity() instanceof ServerPlayer player) {
            FishingManager.get().forget(player);
        }
    }

    @SubscribeEvent
    public static void onPlayerClone(PlayerEvent.Clone event) {
        // 死亡后清场（鱼获还没钓上来，不进入背包）
        if (event.getEntity() instanceof ServerPlayer player) {
            FishingManager.get().forget(player);
        }
    }

    @SubscribeEvent
    public static void onServerStopped(ServerStoppedEvent event) {
        // 服务器关闭：清掉所有会话（不写盘，浮漂实体本身会随存档保存）
        AnglersTackle.LOGGER.info("[垂纶] 服务器停止，清理 {} 个活跃钓鱼会话",
                FishingManager.get().activeCount());
    }

    /** 注册数据包重载监听：教程书内容支持 /reload 热更新。 */
    @SubscribeEvent
    public static void onAddReloadListener(net.neoforged.neoforge.event.AddReloadListenerEvent event) {
        event.addListener(new com.whitecobalt.anglertackle.guide.GuideData.ReloadListener());
    }
}
