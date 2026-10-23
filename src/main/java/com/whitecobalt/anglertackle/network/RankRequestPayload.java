package com.whitecobalt.anglertackle.network;

import com.whitecobalt.anglertackle.AnglersTackle;
import net.minecraft.network.FriendlyByteBuf;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.Identifier;

/**
 * 客户端 → 服务端：请求某个榜单的快照（2026-10-10 M1 第 5 步 ✓）。
 *
 * <p>带一个参数：维度的 id（{@code heaviest} / {@code longest_fight} … ✓，见 {@code Leaderboard.Board.id()} ✓）。
 * 空串表示"主榜" ✓（最重总榜 ✓）。
 *
 * <p>⚠ 这只是**读请求** ✓：服务端收到后只读 {@code LeaderboardData} ✓，
 * 不接受任何成绩字段 ✓ —— 成绩只能由服务端在上鱼那一刻写 ✓（用户定案：服务端权威 ✓）。
 */
public record RankRequestPayload(String boardId) implements CustomPacketPayload {

    public static final RankRequestPayload DEFAULT = new RankRequestPayload("");

    public static final CustomPacketPayload.Type<RankRequestPayload> TYPE =
            new CustomPacketPayload.Type<>(Identifier.fromNamespaceAndPath(AnglersTackle.MOD_ID, "rank_request"));

    public static final StreamCodec<FriendlyByteBuf, RankRequestPayload> STREAM_CODEC = StreamCodec.of(
            (buf, p) -> buf.writeUtf(p.boardId() == null ? "" : p.boardId(), 32),
            buf -> new RankRequestPayload(buf.readUtf(32)));

    @Override
    public Type<? extends CustomPacketPayload> type() {
        return TYPE;
    }
}