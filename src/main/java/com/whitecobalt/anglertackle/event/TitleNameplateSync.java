package com.whitecobalt.anglertackle.event;

import com.whitecobalt.anglertackle.AnglersTackle;
import com.whitecobalt.anglertackle.network.ModNetwork;
import net.minecraft.server.level.ServerPlayer;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.EventBusSubscriber;
import net.neoforged.neoforge.event.entity.player.PlayerEvent;

/**
 * 称号名牌那张表的**进出场广播**（`docs/38` §2.1）。
 *
 * <p>为什么进服要发：名牌由客户端渲染，而客户端**不知道别人的称号**。
 * 不发的话，B 会比 A 晚一步看到 A 的称号 —— 要等 A 换一次佩戴才有。
 *
 * <p>为什么退服也要发：那张表是"当前在线的人"，有人走了就得刷新，
 * 否则他的称号会留在别人客户端上（而且要等到下一次有人换佩戴）。
 * ⚠ 退服时**显式跳过**正在离开的那个人 —— 原版是"先发事件、后移出玩家列表"，
 * 不跳过的话他还在表里（详见 {@link ModNetwork#broadcastNameplates}）。
 *
 * <p>佩戴变化那一条不在这里 —— 在 {@code Titles.equip/unequip}（唯一改佩戴的入口）。
 */
@EventBusSubscriber(modid = AnglersTackle.MOD_ID)
public final class TitleNameplateSync {

    private TitleNameplateSync() {
    }

    @SubscribeEvent
    public static void onLogin(PlayerEvent.PlayerLoggedInEvent event) {
        if (event.getEntity() instanceof ServerPlayer sp) {
            ModNetwork.broadcastNameplates(sp.level().getServer());
        }
    }

    @SubscribeEvent
    public static void onLogout(PlayerEvent.PlayerLoggedOutEvent event) {
        if (event.getEntity() instanceof ServerPlayer sp) {
            ModNetwork.broadcastNameplates(sp.level().getServer(), sp.getUUID());
        }
    }
}
