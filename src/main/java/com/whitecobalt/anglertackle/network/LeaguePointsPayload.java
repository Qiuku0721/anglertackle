package com.whitecobalt.anglertackle.network;

import com.whitecobalt.anglertackle.AnglersTackle;
import net.minecraft.network.FriendlyByteBuf;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.ResourceLocation;

/**
 * 服务端 → 客户端：同步**联赛积分**余额（`docs/39`）。
 *
 * <h2>为什么不并进 {@link CoinsPayload}</h2>
 * 鱼币那个包是早就上线的东西，**所有**改币的地方都依赖它；联赛积分是**另一条货币线**，
 * 变动时机也不同（积分还会在结算时发、在联赛商店里花）。并成一个包的话，以后任何一处
 * 改动都要同时动"老钱包"那条线 —— 那是拿已经稳定的经济系统冒险。
 * 所以**照鱼币的样子另开一个单数字小包**：同样不推整份附件
 * （{@link com.whitecobalt.anglertackle.player.PlayerFishingData} 里还有整本图鉴）。
 *
 * <p>同 {@link CoinsPayload}：客户端**没有**任何本地加分路径，改这个包也刷不出积分。
 *
 * <p>⚠ 单一数据源：这个数字的来源是 `LeaguePoints.balance`／`PlayerData.leaguePoints()`，
 * **不要在别处另算一份**（`docs/39` §3 的口径只有一处）。
 */
public record LeaguePointsPayload(long points) implements CustomPacketPayload {

    public static final CustomPacketPayload.Type<LeaguePointsPayload> TYPE =
            new CustomPacketPayload.Type<>(ResourceLocation.fromNamespaceAndPath(
                    AnglersTackle.MOD_ID, "league_points"));

    public static final StreamCodec<FriendlyByteBuf, LeaguePointsPayload> STREAM_CODEC =
            StreamCodec.of(
                    (buf, p) -> buf.writeLong(p.points),
                    buf -> new LeaguePointsPayload(buf.readLong()));

    @Override
    public Type<? extends CustomPacketPayload> type() {
        return TYPE;
    }
}
