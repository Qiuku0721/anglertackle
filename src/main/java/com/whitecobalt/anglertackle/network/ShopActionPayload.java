package com.whitecobalt.anglertackle.network;

import com.whitecobalt.anglertackle.AnglersTackle;
import net.minecraft.network.RegistryFriendlyByteBuf;
import net.minecraft.network.codec.ByteBufCodecs;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.Identifier;

/**
 * 客户端 → 服务端：商店操作。
 *
 * <p>三种操作共用一个包，靠 {@code entryId} 区分：
 * <ul>
 *   <li>{@code ""}（空串） —— "打开商店"，服务端回一份 {@link ShopSyncPayload}</li>
 *   <li>商品 id —— 买 / 兑换那件商品（到底算买还是兑换由**服务端查目录**决定，
 *       客户端说了不算）</li>
 *   <li>{@link #OP_RATE} —— 请求一次等级评定</li>
 * </ul>
 *
 * <p><b>客户端只发"我想要什么"，不发"我该付多少"。</b>
 * 价格、解锁档位、限购全部由服务端从 {@code ShopCatalog} 现查 ——
 * 否则改一个包就能一块钱买合金竿。
 */
public record ShopActionPayload(String entryId) implements CustomPacketPayload {

    /** 等级评定的伪 id。不能用真实商品 id，避免和将来的商品重名。 */
    public static final String OP_RATE = "@rate";

    /** 打开商店（只请求数据，不做任何交易）。 */
    public static final String OP_OPEN = "";

    /**
     * 卖出玩家背包第 N 格的鱼，格式 {@code @sell:<槽位号>}。
     *
     * <p>客户端只报**槽位号**，价格由服务端读那一格现算 ——
     * 否则改个包就能把一条鲫鱼卖成红鱼的价。
     */
    public static final String OP_SELL_PREFIX = "@sell:";

    /** 修杆：值是玩家背包槽位号。与卖鱼一样，服务端会重新校验一遍。 */
    public static final String OP_REPAIR_PREFIX = "@repair:";

    /**
     * 「鱼 → 原版物品」的兑换：值是 {@code ShopCatalog.EXCHANGES} 里的下标。
     *
     * <p>客户端只报"我要换第几条"：要几条鱼、什么品质、给什么东西，
     * 全部由服务端从 {@code ShopCatalog.EXCHANGES} 现查 ——
     * 否则改个包就能拿一条鲫鱼换钻石。
     */
    public static final String OP_EXCHANGE_PREFIX = "@exch:";

    /** 买**联赛商店**的第 index 条报价（`docs/39` P4）。 */
    public static final String OP_LEAGUE_PREFIX = "@lg:";

    /** 买联赛商店第 {@code index} 条报价（客户端**只发下标**：价格与限购一律服务端现查 ✓）。 */
    public static ShopActionPayload league(int index) {
        return new ShopActionPayload(OP_LEAGUE_PREFIX + index);
    }

    public static ShopActionPayload exchange(int index) {
        return new ShopActionPayload(OP_EXCHANGE_PREFIX + index);
    }

    public static ShopActionPayload repair(int slot) {
        return new ShopActionPayload(OP_REPAIR_PREFIX + slot);
    }

    public static ShopActionPayload sell(int slot) {
        return new ShopActionPayload(OP_SELL_PREFIX + slot);
    }

    public static final Type<ShopActionPayload> TYPE = new Type<>(
            Identifier.fromNamespaceAndPath(AnglersTackle.MOD_ID, "shop_action"));

    public static final StreamCodec<RegistryFriendlyByteBuf, ShopActionPayload> STREAM_CODEC =
            StreamCodec.composite(
                    ByteBufCodecs.STRING_UTF8, ShopActionPayload::entryId,
                    ShopActionPayload::new);

    public static ShopActionPayload open() {
        return new ShopActionPayload(OP_OPEN);
    }

    public static ShopActionPayload rate() {
        return new ShopActionPayload(OP_RATE);
    }

    public static ShopActionPayload of(String id) {
        return new ShopActionPayload(id);
    }

    @Override
    public Type<? extends CustomPacketPayload> type() {
        return TYPE;
    }
}
