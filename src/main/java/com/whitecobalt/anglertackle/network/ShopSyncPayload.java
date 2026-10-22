package com.whitecobalt.anglertackle.network;

import com.whitecobalt.anglertackle.AnglersTackle;
import net.minecraft.network.RegistryFriendlyByteBuf;
import net.minecraft.network.codec.ByteBufCodecs;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.ResourceLocation;

/**
 * 服务端 → 客户端：商店状态（打开界面 / 每次交易后都会重发一份）。
 *
 * <h2>为什么限购状态压成一个字符串</h2>
 * 用 {@code List<Stock>} 那种结构化编码当然更"正"，但要多写一对 StreamCodec，
 * 而且集合编解码器在各版本里的名字不统一（踩过一次名字猜错的坑）。
 * 这里的数据形状很固定（"id:剩余分钟"），压成 CSV 既好读又好查 ——
 * 出问题时日志里直接能看懂，不用写个解码器去看。
 *
 * @param stage    老柯商店解锁档位（1–5）——由垂纶等级推导
 * @param level    垂纶等级（1–50）
 * @param xp       当前等级已有经验（卡在评定点时是 0）
 * @param talked   有没有说过第一句话（false 时界面显示"先跟老柯聊聊"）
 * @param soldOut  售罄中的商品，格式 {@code id:剩余分钟;id:剩余分钟}；空串 = 都没有售罄
 * @param leagueTag 当前联赛标记 {@code <届号>|<规模>}（空串 = 还没开过任何一届）——
 *                 联赛商店的**纪念称号**名字是带参数的模板（{@code S%s%s联赛纪念}），
 *                 客户端得知道"第几届、哪个规模"才能把占位符填上；
 *                  不传的话那一行会**把 {@code %s} 原样画出来**（用户 2026-10-13 截图发现）✗
 *                  ⚠ 为什么压成一个字符串：{@code StreamCodec.composite} **最多 6 个字段**
 *                  （本版本只有到 6 的重载），拆成"届号 + 规模"两个字段就编译不过 ✗
 */
public record ShopSyncPayload(int stage, int level, int xp, boolean talked, String soldOut,
                              String leagueTag)
        implements CustomPacketPayload {

    public static final Type<ShopSyncPayload> TYPE = new Type<>(
            ResourceLocation.fromNamespaceAndPath(AnglersTackle.MOD_ID, "shop_sync"));

    public static final StreamCodec<RegistryFriendlyByteBuf, ShopSyncPayload> STREAM_CODEC =
            StreamCodec.composite(
                    ByteBufCodecs.VAR_INT, ShopSyncPayload::stage,
                    ByteBufCodecs.VAR_INT, ShopSyncPayload::level,
                    ByteBufCodecs.VAR_INT, ShopSyncPayload::xp,
                    ByteBufCodecs.BOOL, ShopSyncPayload::talked,
                    ByteBufCodecs.STRING_UTF8, ShopSyncPayload::soldOut,
                    ByteBufCodecs.STRING_UTF8, ShopSyncPayload::leagueTag,
                    ShopSyncPayload::new);

    @Override
    public Type<? extends CustomPacketPayload> type() {
        return TYPE;
    }
}
