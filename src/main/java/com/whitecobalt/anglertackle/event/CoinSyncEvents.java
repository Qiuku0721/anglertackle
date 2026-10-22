package com.whitecobalt.anglertackle.event;

import com.whitecobalt.anglertackle.AnglersTackle;
import com.whitecobalt.anglertackle.network.ModNetwork;
import net.neoforged.api.distmarker.Dist;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.EventBusSubscriber;
import net.neoforged.neoforge.event.entity.player.PlayerEvent;

/**
 * 鱼币余额的进出场同步。
 *
 * <h2>为什么进服要主动推一次</h2>
 * {@code ClientCoins} 的初始值是"未知"，没收到同步就什么都不画。
 * 不在这里推的话，玩家进游戏后要先钓到一条鱼才看得见余额 ——
 * 而那之前 HUD 上是空的，看起来就像面板坏了。
 *
 * <h2>为什么退出要清</h2>
 * 客户端缓存是静态的，退出服务器不清理的话，进下一个存档会先显示**上一个档的余额**，
 * 直到新同步到达。那一下闪现的假数字比"暂时空着"糟糕得多 ——
 * 用户刚好在验收"每个档不同"这件事。
 */
@EventBusSubscriber(modid = AnglersTackle.MOD_ID)
public final class CoinSyncEvents {

    private CoinSyncEvents() {
    }

    @SubscribeEvent
    public static void onLogin(PlayerEvent.PlayerLoggedInEvent event) {
        if (event.getEntity() instanceof net.minecraft.server.level.ServerPlayer sp) {
            ModNetwork.syncCoins(sp);
            // 联赛积分同理（`docs/39`）：不在这里推的话，HUD 上那一行要等到
            // 第一次上鱼/第一次进商店才出现 —— 看起来就像"没做这个显示"。
            ModNetwork.syncLeaguePoints(sp);
        }
    }

    @SubscribeEvent
    public static void onChangeDimension(PlayerEvent.PlayerChangedDimensionEvent event) {
        // 换维度时客户端会重建一部分状态，顺手再推一次，保证面板不会空着
        if (event.getEntity() instanceof net.minecraft.server.level.ServerPlayer sp) {
            ModNetwork.syncCoins(sp);
            ModNetwork.syncLeaguePoints(sp);
        }
    }

    /** 客户端侧：退出世界时清掉缓存。 */
    @EventBusSubscriber(modid = AnglersTackle.MOD_ID, value = Dist.CLIENT)
    public static final class Client {

        private Client() {
        }

        @SubscribeEvent
        public static void onLoggingOut(net.neoforged.neoforge.client.event.ClientPlayerNetworkEvent.LoggingOut event) {
            com.whitecobalt.anglertackle.client.ClientCoins.reset();
            // 联赛积分同样跟着玩家附件走 —— 不清的话，下一个档会先显示上一个档的积分
            com.whitecobalt.anglertackle.client.ClientLeaguePoints.reset();
            // 图鉴缓存同理，而且更明显：换存档时图鉴是**另一份**（附件跟着玩家 NBT 走），
            // 不清的话下一个档会先画上一个档的收集进度 —— 用户刚好在验收"每个档不同"。
            com.whitecobalt.anglertackle.client.ClientCodex.reset();
            // 邮箱与称号同理（2026-10-12 补）：这两个缓存都是**跟着玩家附件走**的，
            // 不清的话换存档/换服务器时界面会先画上一个档的邮件与"已获得"状态 ——
            // 那一眼看起来就像"新档里我已经有这些称号了"（比图鉴那次更容易被当真）。
            com.whitecobalt.anglertackle.client.ClientMails.clear();
            com.whitecobalt.anglertackle.client.ClientTitles.clear();
            // 称号**名牌**那张表同理（`docs/38` §2.1）：不清的话，进下一个档的第一眼
            // 会给上一个档的玩家挂上称号 —— 而那张表本来也是"当前这个服务器在线的人"。
            com.whitecobalt.anglertackle.client.ClientNameplates.clear();
            // 委托面板缓存同理（`docs/40` §9，2026-10-14 补）：它是**跟着玩家附件走**的，
            // 不清的话换档/换服时面板会先画上一个档的委托进度 —— 一眼就像"这个档我已经接了这些活"。
            com.whitecobalt.anglertackle.client.ClientQuests.clear();
            // 成就面板（docs/41 §7 A4）：同一条纪律 —— 不清的话换存档会先闪一眼上个存档的成就
            com.whitecobalt.anglertackle.client.ClientAchievements.clear();
            // （罗盘目标原来也要清 —— 罗盘 2026-10-02 删了，改成一次性的定位线索，
            //   没有常驻缓存需要清。）
            com.whitecobalt.anglertackle.client.ClientShopState.reset();
        }
    }
}
