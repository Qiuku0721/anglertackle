package com.whitecobalt.anglertackle.fishing;

import com.whitecobalt.anglertackle.network.CodexPayload;
import com.whitecobalt.anglertackle.player.PlayerData;
import net.minecraft.server.level.ServerPlayer;

import java.util.ArrayList;
import java.util.List;

/**
 * 把玩家的图鉴记录组装成一份可以下发的快照。
 *
 * <p>单独一个类而不是塞进 {@code ModNetwork}：这里是**业务**（哪些鱼、
 * 按什么顺序、每行放什么字段），ModNetwork 只该管收发。
 * 以后做排序切换、只看已收集之类的功能，改这一个文件就够。
 */
public final class CodexSnapshot {

    private CodexSnapshot() {
    }

    /**
     * 行格式（顺序固定，与 {@link CodexPayload} 的注释一致）：
     * {@code 鱼种id|次数|最大kg|最大cm|最小kg|最小cm|最高档|评级位掩码|首次时间}
     *
     * <p>没钓到过的鱼种也发（次数 0）—— 图鉴不隐藏，让玩家知道还有什么在等。
     */
    public static CodexPayload of(ServerPlayer player) {
        var data = PlayerData.get(player);
        List<String> rows = new ArrayList<>(FishSpecies.ALL.size());
        for (FishSpecies sp : FishSpecies.ALL) {
            var e = data.codex().get(sp.id());
            if (e == null) {
                rows.add(sp.id() + "|0|0|0|0|0|-1|0|0");
            } else {
                rows.add(sp.id() + "|" + e.count()
                        + "|" + e.maxKg() + "|" + e.maxCm()
                        + "|" + e.minKg() + "|" + e.minCm()
                        + "|" + e.bestTier()
                        + "|" + e.gradesSeen()
                        + "|" + e.firstCaughtAt());
            }
        }
        return new CodexPayload(rows, data.coins(), FishSpecies.ALL.size());
    }
}
