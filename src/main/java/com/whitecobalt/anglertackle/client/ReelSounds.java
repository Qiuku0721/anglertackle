package com.whitecobalt.anglertackle.client;

import net.minecraft.client.Minecraft;
import net.minecraft.sounds.SoundEvent;
import net.minecraft.sounds.SoundEvents;

/**
 * 收线时的声音（用户 2026-10-05："路亚收线时没有声音"）。
 *
 * <h2>为什么用原版音效、不加自己的 ogg</h2>
 * 用户要的是"收线有个响"，而**原版 1.21.1 有两个现成的、语义都对得上的音效**
 * （不是猜的：从本机 `assets/indexes` 里的 `minecraft/sounds.json` 逐个查过，共 1613 个音效）：
 * <table>
 *   <tr><td>{@code block.lever.click}</td><td>短促的机械"咔哒" —— 当**摇轮**的那一下</td></tr>
 *   <tr><td>{@code entity.fishing_bobber.retrieve}</td><td>原版收线时的"线收进来"底噪 —— 当**底层哗啦**</td></tr>
 * </table>
 * 于是不用往仓库里塞音频文件（体积 + 授权都不必操心），也不依赖任何资源包。
 *
 * <h2>可选替换（想换味道就改这两个常量）</h2>
 * · 金属感更强：{@code item.armor.equip_chain}（铁链哗啦）或 {@code block.chain.step}
 * · 木质纺车轮：{@code block.wooden_button.click_on}（{@code random/wood_click}）
 * · 更闷的齿轮：{@code block.piston.contract}
 * 这些 id 都在原版 sounds.json 里，换一个常量即可，不需要新增资源。
 *
 * <h2>为什么放在客户端</h2>
 * "有没有在收线"是**本地输入**（左键按住），服务端每 tick 同步一次反而更糊；
 * 而且声音纯表现，不该占网络包。所以由 {@link ClientEvents#onClientTick} 每 tick 调一次，
 * 状态取 {@link ClientFishingState}（它本来就是本地预测的那份状态）。
 *
 * <h2>张力→音高</h2>
 * 张力越接近上限，咔哒声越尖、越响一点点（{@code dangerRatio()} 0→1），
 * 玩家不用盯 HUD 也能靠耳朵听出"该放线了"。这是手感的一部分，不是花活。
 */
public final class ReelSounds {

    /** 摇轮咔哒的间隔（tick）：4 tick = 每秒 5 声，接近真实纺车轮的节奏。 */
    private static final int CRANK_INTERVAL = 4;
    /** "线收进来"底噪的间隔：比咔哒稀，避免糊成一片。 */
    private static final int WHIRR_INTERVAL = 12;
    /** 咔哒声的音量（**故意很小**：一声不吵，连起来才有节奏感）。 */
    private static final float CRANK_VOLUME = 0.16F;
    /** 底噪音量（更低，只当背景）。 */
    private static final float WHIRR_VOLUME = 0.09F;

    private static SoundEvent crank = SoundEvents.LEVER_CLICK;
    private static SoundEvent whirr = SoundEvents.FISHING_BOBBER_RETRIEVE;

    private static int tick;
    private static float smoothDanger;

    private ReelSounds() {
    }

    /** 收线时每 tick 调一次；不在收线就什么都不做（并把节奏重置）。 */
    public static void tick(ClientFishingState state) {
        Minecraft mc = Minecraft.getInstance();
        if (mc.player == null || mc.level == null) {
            reset();
            return;
        }
        // 只在"有会话 + 正在收线 + 不在蓄力"时响 —— 蓄力是抛投前那一段，不该有摇轮声
        if (!state.inSession() || !state.reeling() || state.charging()) {
            reset();
            return;
        }

        // 张力平滑一下：dangerRatio 每 tick 会抖，直接拿来算音高会"唱歌"
        smoothDanger += (state.dangerRatio() - smoothDanger) * 0.25F;

        tick++;
        if (tick % CRANK_INTERVAL == 0) {
            // 张力越高：音高越高（1.05→1.55）、略响一点（1.0→1.25 倍）
            float pitch = 1.05F + smoothDanger * 0.50F + (float) (mc.level.getRandom().nextFloat() * 0.06 - 0.03);
            float volume = CRANK_VOLUME * (1.0F + smoothDanger * 0.25F);
            mc.player.playSound(crank, volume, pitch);
        }
        if (tick % WHIRR_INTERVAL == 0) {
            mc.player.playSound(whirr, WHIRR_VOLUME, 0.95F + smoothDanger * 0.20F);
        }
    }

    private static void reset() {
        tick = 0;
        smoothDanger = 0.0F;
    }
}
