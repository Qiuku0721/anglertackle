package com.whitecobalt.anglertackle.network;

import java.util.ArrayList;
import java.util.List;

import com.whitecobalt.anglertackle.AnglersTackle;
import net.minecraft.network.FriendlyByteBuf;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.ResourceLocation;

/**
 * 服务端 → 客户端：**全部榜单**的快照（2026-10-10 M1 ✓，用户要求"像老柯界面那样能切板块"✓）。
 *
 * <h2>一次发全部 ✓（不再一次一个榜 ✗）</h2>
 * 十来个榜、每榜十来行 ✓，总量几 KB ✓ ⇒ 一次全发 ✓，界面里切板块就是**纯本地操作** ✓：
 * 零网络往返 ✓（不卡手 ✓）、也不需要再写一个"客户端→服务端"的请求包 ✓
 * （2026-10-10 就是那个反向包把方向搞错、直接掉线 ✗ —— 少一个包就少一个坑 ✓）。
 *
 * <h2>为什么压成一个字符串 ✓</h2>
 * 照仓库既有教训（见 {@code ShopSyncPayload} 的注释 ✓）：给 {@code List} 单独写一对编解码器，
 * 在不同版本里集合编解码器的**名字不统一** ✗，踩过一次 ✓。这里用两个**不可能出现在正文里**的
 * 不可见分隔符压平 ✓：
 * <pre>
 *   \u0001  字段分隔（榜单块之间）
 *   \u0002  行分隔（块内：id / 名称 / 页脚 / 正文各行）
 * </pre>
 * ⇒ 编解码只用 `STRING_UTF8` 一个字段 ✓，版本无关 ✓，出问题日志里也看得懂 ✓。
 */
public record RankPayload(String blob, String prefer) implements CustomPacketPayload {

    public static final CustomPacketPayload.Type<RankPayload> TYPE =
            new CustomPacketPayload.Type<>(ResourceLocation.fromNamespaceAndPath(AnglersTackle.MOD_ID, "rank_sync"));

    public static final StreamCodec<FriendlyByteBuf, RankPayload> STREAM_CODEC = StreamCodec.of(
            (buf, p) -> {
                // ⚠ 上限从 32767 提到 131071（2026-10-13）：加了"总联赛榜"之后板块变成
                //   ~47 个（10 维度 × 3 规模 + 联赛/赛季 + 原有 10 + 本场），
                //   原上限**已经贴着边**了 —— 一超就 writeUtf 抛异常，表现是"打开排行榜掉线" ✗。
                //   两端都是本模组自己的实现（同版本），所以放宽是安全的 ✓。
                buf.writeUtf(p.blob() == null ? "" : p.blob(), 131071);
                buf.writeUtf(p.prefer() == null ? "" : p.prefer(), 64);
            },
            buf -> new RankPayload(buf.readUtf(131071), buf.readUtf(64)));

    /** 一个榜单的展示数据 ✓（界面只读它 ✓）。 */
    public record Board(String id, String name, List<String> lines, String footer) {
    }

    /** 解开成可用的结构 ✓（坏数据只会得到空列表 ✓，绝不抛异常 ✗）。 */
    public List<Board> boards() {
        List<Board> out = new ArrayList<>();
        if (this.blob == null || this.blob.isEmpty()) {
            return out;
        }
        for (String chunk : this.blob.split("\u0001")) {
            if (chunk.isEmpty()) {
                continue;
            }
            String[] f = chunk.split("\u0002", -1);
            if (f.length < 3) {
                continue;
            }
            List<String> lines = new ArrayList<>();
            for (int i = 3; i < f.length; i++) {
                if (!f[i].isEmpty()) {
                    lines.add(f[i]);
                }
            }
            out.add(new Board(f[0], f[1], List.copyOf(lines), f.length > 2 ? f[2] : ""));
        }
        return out;
    }

    /** 打包 ✓（{@code RankSnapshot} 用；界面不用管 ✓）。 */
    public static String pack(List<Board> boards) {
        StringBuilder sb = new StringBuilder();
        for (Board b : boards) {
            if (sb.length() > 0) {
                sb.append('\u0001');
            }
            sb.append(b.id()).append('\u0002').append(b.name()).append('\u0002').append(b.footer());
            for (String line : b.lines()) {
                sb.append('\u0002').append(line.replace('\u0001', ' ').replace('\u0002', ' '));
            }
        }
        return sb.toString();
    }

    @Override
    public Type<? extends CustomPacketPayload> type() {
        return TYPE;
    }
}