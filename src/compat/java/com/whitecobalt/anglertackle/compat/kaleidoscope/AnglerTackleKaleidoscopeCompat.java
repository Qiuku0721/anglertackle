package com.whitecobalt.anglertackle.compat.kaleidoscope;

import com.whitecobalt.anglertackle.registry.ModItems;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.fml.common.Mod;
import net.neoforged.fml.event.lifecycle.FMLCommonSetupEvent;
import net.neoforged.neoforge.common.NeoForge;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * 《垂纶》×《森罗物语》扩展包入口。
 *
 * <h2>为什么是独立 jar，而不是主 jar 里的一个类</h2>
 * 主 jar 与森罗**完全解耦**：不装森罗时，主 jar 里连他们一个类名都不该出现
 * （{@code tools/check-kaleidoscope-compat.js} 断言 6 在守）。而这里要直接调他们的公开 API
 * （{@code IChoppingBoard} / {@code StockpotMatchRecipeEvent}），编译期就得有他们的 jar ——
 * 所以隔离在独立源集 {@code src/compat} + 独立 jar {@code anglertackle-kaleidoscope} 里。
 * 不装森罗时这个包整包不加载（{@code neoforge.mods.toml} 里 anglertackle 与
 * kaleidoscope_cookery 都是 required），主 jar 的原路径一行都不会走到兼容分支。
 *
 * <h2>他们 jar 的用法约定（AGENTS.md 的规矩）</h2>
 * · 只读：{@code libs/kaleidoscope_cookery-*.jar} 只是 compileOnly 的编译输入，
 *   构建前后 sha256 必须一致（{@code tools/check-kaleidoscope-compat.js} 在比对）。
 * · 只用**公开 API 与可取消事件**，不用 Mixin、不碰字节码、不覆盖他们的 data 文件。
 */
@Mod(AnglerTackleKaleidoscopeCompat.MOD_ID)
public final class AnglerTackleKaleidoscopeCompat {

    public static final String MOD_ID = "anglertackle_kaleidoscope";
    private static final Logger LOGGER = LoggerFactory.getLogger("AnglerTackle/Kaleidoscope");

    public AnglerTackleKaleidoscopeCompat(IEventBus modBus) {
        // 游戏总线：他们的两个入口都发在 NeoForge.EVENT_BUS 上（javap 验过，不是猜的）
        NeoForge.EVENT_BUS.addListener(BoardTakeover::onRightClickBlock);
        // 只挂 Pre：他们的 setRecipe 顺序是 Pre → 非flex → Post → flex，
        // 而我们的配方全是 flex_stockpot —— Post 时 flex 还没匹配，挂它等于没挂（1.4.0/1.4.1 的错）
        NeoForge.EVENT_BUS.addListener(StockpotTakeover::onPre);
        // 炒锅：他们没有事件可用，只能卡"出锅"那一下换货（见 PotTakeover 的类注释）
        NeoForge.EVENT_BUS.addListener(PotTakeover::onRightClickBlock);
        NeoForge.EVENT_BUS.addListener(StockpotTakeover::onRightClickBlock);
        NeoForge.EVENT_BUS.addListener(SteamerTakeover::onRightClickBlock);
        modBus.addListener(this::onCommonSetup);
    }

    private void onCommonSetup(FMLCommonSetupEvent event) {
        LOGGER.info("垂纶 × 森罗物语扩展包已加载：砧板按重量切块 / 鱼块 1:1 出鱼丸 / 汤锅·炒锅·蒸笼数据保真");
    }
}
