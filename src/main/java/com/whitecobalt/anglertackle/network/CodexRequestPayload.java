package com.whitecobalt.anglertackle.network;

import com.whitecobalt.anglertackle.AnglersTackle;
import net.minecraft.network.FriendlyByteBuf;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.ResourceLocation;

/**
 * 客户端 → 服务端：请求一本图鉴快照。
 *
 * <p>不带参数：图鉴永远是"这个玩家自己的全部记录"，没有筛选条件可言。
 * 排序/只看已收集这类**纯显示**的筛选放在客户端做 —— 让服务端为
 * "玩家点了下排序"重发一次全量数据是没必要的。
 *
 * <p>两段式（请求 → 下发）而不是把数据塞在物品里：21 条鱼的完整记录
 * 放进物品 NBT 会让每一条鱼都变重，而且玩家卖鱼/丢鱼之后就查不到了。
 * 图鉴是**玩家数据**，不是鱼身上的数据。
 */
public record CodexRequestPayload() implements CustomPacketPayload {

    public static final CodexRequestPayload INSTANCE = new CodexRequestPayload();

    public static final CustomPacketPayload.Type<CodexRequestPayload> TYPE =
            new CustomPacketPayload.Type<>(ResourceLocation.fromNamespaceAndPath(
                    AnglersTackle.MOD_ID, "codex_request"));

    public static final StreamCodec<FriendlyByteBuf, CodexRequestPayload> STREAM_CODEC =
            StreamCodec.unit(INSTANCE);

    @Override
    public Type<? extends CustomPacketPayload> type() {
        return TYPE;
    }
}
