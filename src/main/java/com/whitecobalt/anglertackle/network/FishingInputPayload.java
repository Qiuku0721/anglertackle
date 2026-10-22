package com.whitecobalt.anglertackle.network;

import com.whitecobalt.anglertackle.AnglersTackle;
import net.minecraft.network.FriendlyByteBuf;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.ResourceLocation;

/**
 * 客户端 → 服务端：钓鱼期间的动作与控杆输入。
 *
 * <p><b>按键方案（已定案）</b>：
 * <ul>
 *   <li><b>左键按住</b> = 收线；<b>松开</b> = 放线</li>
 *   <li>咬钩（提竿窗口）时 <b>左键</b> = 提竿</li>
 *   <li><b>A / D</b> = 控杆方向（正拉 / 反拉），不按 = 垂直（中立）</li>
 * </ul>
 *
 * <p>用 2 个字节压缩（每 tick 一次，流量可忽略）：
 * <pre>
 *   flags bit0  左键按下（收线 / 提竿）
 *   flags bit1  提竿请求（本 tick 新按下，仅在提竿窗口有效）
 *   flags bit2  提前收回请求（本 tick 新按下右键）
 *   dir   -1 左 / 0 垂直(中立) / +1 右
 * </pre>
 *
 * <p>注意：<b>左键在 MC 里默认是挖掘/攻击</b>。客户端只在
 * 「手持本模组钓竿 + 存在活跃会话」时才拦截它，
 * 其他情况完全不碰（见 {@code ClientEvents}）。
 */
public record FishingInputPayload(byte flags, byte dir) implements CustomPacketPayload {

    /** 左键按住（收线）。 */
    public static final byte BIT_PRIMARY_HELD = 0b01;
    /** 提竿请求（本 tick 新按下）。 */
    public static final byte BIT_HOOK_REQUEST = 0b10;
    /**
     * 提前收回请求（本 tick 新按下右键）。
     *
     * <p>为什么要单独走这个包，而不是靠 {@code RodItem.use()} 里的服务端调用：
     * 服务端在 {@code use()} 里收回时会调 {@code stopUsingItem()}，
     * 客户端随之把"正在使用物品"从 true 翻成 false —— 而客户端的
     * <b>松手检测正是靠这个下降沿</b>（见 {@code ClientEvents}），
     * 于是同一次右键会再发一个 {@code CastPayload}，表现为
     * "提前收回的瞬间又抛了一杆"。
     * 走输入包就绕开了物品使用状态，不再触发那个下降沿。
     */
    public static final byte BIT_RETRIEVE = 0b100;

    public static final CustomPacketPayload.Type<FishingInputPayload> TYPE =
            new CustomPacketPayload.Type<>(ResourceLocation.fromNamespaceAndPath(AnglersTackle.MOD_ID, "fishing_input"));

    public static final StreamCodec<FriendlyByteBuf, FishingInputPayload> STREAM_CODEC = StreamCodec.of(
            (buf, p) -> {
                buf.writeByte(p.flags);
                buf.writeByte(p.dir);
            },
            buf -> new FishingInputPayload(buf.readByte(), buf.readByte())
    );

    /** 左键是否按住 → 收线。 */
    public boolean primaryHeld() {
        return (flags & BIT_PRIMARY_HELD) != 0;
    }

    /** 是否请求提竿（客户端在提竿窗口内新按下左键时置位）。 */
    public boolean hookRequested() {
        return (flags & BIT_HOOK_REQUEST) != 0;
    }

    /** 是否请求提前收回（客户端在等咬钩期间新按下右键时置位）。 */
    public boolean retrieveRequested() {
        return (flags & BIT_RETRIEVE) != 0;
    }

    /** 控杆方向：-1 左 / 0 垂直(中立) / +1 右。 */
    public int direction() {
        return Integer.signum(dir);
    }

    public static FishingInputPayload pack(boolean primaryHeld, boolean hookRequest, int direction) {
        return pack(primaryHeld, hookRequest, false, direction);
    }

    public static FishingInputPayload pack(boolean primaryHeld, boolean hookRequest,
                                           boolean retrieveRequest, int direction) {
        byte f = 0;
        if (primaryHeld) {
            f |= BIT_PRIMARY_HELD;
        }
        if (hookRequest) {
            f |= BIT_HOOK_REQUEST;
        }
        if (retrieveRequest) {
            f |= BIT_RETRIEVE;
        }
        return new FishingInputPayload(f, (byte) Integer.signum(direction));
    }

    @Override
    public Type<? extends CustomPacketPayload> type() {
        return TYPE;
    }
}
