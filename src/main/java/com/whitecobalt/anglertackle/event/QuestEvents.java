package com.whitecobalt.anglertackle.event;

import com.whitecobalt.anglertackle.AnglersTackle;
import com.whitecobalt.anglertackle.quest.QuestService;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.EventBusSubscriber;
import net.neoforged.neoforge.event.entity.player.PlayerEvent;
import net.neoforged.neoforge.event.tick.LevelTickEvent;

/**
 * 委托的**事件入口**（`docs/40` §3.4）：日界推进 + 登录补发。
 *
 * <h2>两条纪律</h2>
 * <ol>
 *   <li><b>只在主世界判日界</b>：{@code getDayTime()} 每个维度各有一份，取主世界那一份才是
 *       "全服同一天"（下界/末地的时间和主世界不一定同步）；</li>
 *   <li><b>绝不因为委托把 tick 拖慢或弄崩</b>：所有逻辑都包 try/catch ——
 *       委托只是"锦上添花"，让它带崩服务端才是灾难（抄 `Titles.syncAuto` 的成例）✓。</li>
 * </ol>
 */
@EventBusSubscriber(modid = AnglersTackle.MOD_ID)
public final class QuestEvents {

    private QuestEvents() {
    }

    /** 每个维度每 tick 一次；只在主世界往下走（`QuestService` 内部还有"日序号没变就返回"的性能闸）。 */
    @SubscribeEvent
    public static void onLevelTick(LevelTickEvent.Post event) {
        try {
            if (!(event.getLevel() instanceof ServerLevel level)) {
                return;
            }
            if (level.getServer() == null || level != level.getServer().overworld()) {
                return;
            }
            QuestService.tickDayBoundary(level.getServer());
        } catch (Throwable t) {
            AnglersTackle.LOGGER.warn("[垂纶] 委托日界推进失败（已忽略）：{}", t.toString());
        }
    }

    /** 登录时补发当天 / 本周的委托（离线跨过了日界也能收到）。 */
    @SubscribeEvent
    public static void onLogin(PlayerEvent.PlayerLoggedInEvent event) {
        try {
            if (event.getEntity() instanceof ServerPlayer sp) {
                QuestService.onLogin(sp);
            }
        } catch (Throwable t) {
            AnglersTackle.LOGGER.warn("[垂纶] 委托登录补发失败（已忽略）：{}", t.toString());
        }
    }
}
