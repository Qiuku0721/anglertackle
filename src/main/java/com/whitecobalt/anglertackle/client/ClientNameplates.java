package com.whitecobalt.anglertackle.client;

import com.whitecobalt.anglertackle.network.TitleNameplatePayload;

import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

/**
 * 客户端侧的「在线玩家 → 已佩戴称号」缓存（`docs/38` §2.1）。
 *
 * <p>与 {@link ClientCoins} / {@link ClientLeaguePoints} / {@link ClientShopState} 同一形状：
 * **只读缓存**，唯一写入口是服务端推来的 {@link TitleNameplatePayload}。
 * 客户端**没有任何本地设置称号的方法** —— 佩戴一律发动作包让服务端判定
 * （"客户端只能说我想要什么"那条纪律）。
 *
 * <p>关键的一步是 {@link #accept}：服务端发的是**整表**，所以这里**先清空再装新的**
 * （不是逐条合并）—— 合并会让"服务端已经删掉的玩家"永远留在客户端上。
 *
 * <p>解析一律**容错**：格式不对的行直接跳过，绝不抛异常（画名牌时抛一下就整帧崩）。
 */
public final class ClientNameplates {

    private static final Map<UUID, String> TITLES = new HashMap<>();

    private ClientNameplates() {
    }

    /** 服务端推来的整表（覆盖式）。 */
    public static void accept(TitleNameplatePayload payload) {
        Map<UUID, String> next = new HashMap<>();
        String blob = payload == null || payload.blob() == null ? "" : payload.blob();
        if (!blob.isEmpty()) {
            for (String line : blob.split(TitleNameplatePayload.LINE_SEP, -1)) {
                if (line.isEmpty()) {
                    continue;
                }
                int cut = line.indexOf(TitleNameplatePayload.FIELD_SEP);
                if (cut <= 0 || cut >= line.length() - 1) {
                    continue;   // 少了 uuid 或少了称号 id ⇒ 这行作废
                }
                try {
                    UUID who = UUID.fromString(line.substring(0, cut));
                    String id = line.substring(cut + 1);
                    if (!id.isEmpty()) {
                        next.put(who, id);
                    }
                } catch (IllegalArgumentException ignored) {
                    // uuid 不合法 ⇒ 跳过这一行（别的行照样算数）
                }
            }
        }
        TITLES.clear();
        TITLES.putAll(next);
    }

    /**
     * 某个玩家当前佩戴的称号 id（没戴 / 不认识这个玩家 ⇒ {@code null}）。
     *
     * <p>⚠ 这是**渲染路径**上的方法：每帧都会被调用（每个可见玩家的名牌），
     * 所以它必须**不分配、不抛异常**（{@link HashMap#get} 两个条件都满足）。
     */
    public static String titleOf(UUID player) {
        return player == null ? null : TITLES.get(player);
    }

    /** 退出世界时清掉 —— 否则下一个存档的名牌会先闪上一个档的称号（同 {@code ClientTitles} 那条纪律）。 */
    public static void clear() {
        TITLES.clear();
    }
}
