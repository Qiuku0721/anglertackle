package com.whitecobalt.anglertackle.network;

import com.whitecobalt.anglertackle.AnglersTackle;
import net.minecraft.network.FriendlyByteBuf;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.ResourceLocation;

/**
 * 客户端 → 服务端：我想看菜谱。
 *
 * <p>不带参数：菜谱内容全是**静态表**（做法 × 允许的鱼 × 效果 × 饱食度），
 * 没有"这个玩家自己"的数据要筛。
 *
 * <p>那为什么还要这一趟往返？—— 只为把"开界面"留在客户端专用类里，
 * 见 {@link com.whitecobalt.anglertackle.item.CookbookItem} 的类注释
 * （common 类里写客户端调用会让整个模组装不进专用服务器）。
 */
public record CookbookRequestPayload() implements CustomPacketPayload {

    public static final CookbookRequestPayload INSTANCE = new CookbookRequestPayload();

    public static final CustomPacketPayload.Type<CookbookRequestPayload> TYPE =
            new CustomPacketPayload.Type<>(ResourceLocation.fromNamespaceAndPath(
                    AnglersTackle.MOD_ID, "cookbook_request"));

    public static final StreamCodec<FriendlyByteBuf, CookbookRequestPayload> STREAM_CODEC =
            StreamCodec.unit(INSTANCE);

    @Override
    public Type<? extends CustomPacketPayload> type() {
        return TYPE;
    }
}
