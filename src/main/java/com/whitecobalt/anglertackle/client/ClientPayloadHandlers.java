package com.whitecobalt.anglertackle.client;

import com.whitecobalt.anglertackle.AnglersTackle;
import com.whitecobalt.anglertackle.client.screen.CodexScreen;
import com.whitecobalt.anglertackle.client.screen.GuideScreen;
import com.whitecobalt.anglertackle.client.screen.RodModScreen;
import com.whitecobalt.anglertackle.client.screen.ShopScreen;
import com.whitecobalt.anglertackle.client.screen.CookbookScreen;
import com.whitecobalt.anglertackle.network.CodexPayload;
import com.whitecobalt.anglertackle.network.CookbookPayload;
import com.whitecobalt.anglertackle.network.CoinsPayload;
import com.whitecobalt.anglertackle.network.GuidePayload;
import com.whitecobalt.anglertackle.network.LeaguePointsPayload;
import com.whitecobalt.anglertackle.network.OreSightPayload;
import com.whitecobalt.anglertackle.network.RodModPayload;
import com.whitecobalt.anglertackle.network.SessionSyncPayload;
import com.whitecobalt.anglertackle.network.ShopSyncPayload;
import com.whitecobalt.anglertackle.network.TitleNameplatePayload;
import net.minecraft.client.Minecraft;
import net.minecraft.network.chat.Component;
import net.neoforged.api.distmarker.Dist;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.EventBusSubscriber;
import net.neoforged.neoforge.network.event.RegisterPayloadHandlersEvent;
import net.neoforged.neoforge.network.handling.IPayloadContext;

/**
 * **服务端→客户端**那几个包的处理与注册（客户端专用）。
 *
 * <h2>⚠ 为什么要单独一个类（2026-10-03 用专用服务器实测出来的）</h2>
 * 这些处理函数原来写在 {@code network/ModNetwork}（common）里。它们在方法体里
 * 直接引用客户端类（{@code Minecraft} / {@code CodexScreen} / {@code ShopScreen}…），
 * 而**专用服务器加载 ModNetwork 时就会去加载 {@code net.minecraft.client.gui.screens.Screen}**：
 * <pre>
 *   ModLoadingException: Angler's Tackle (anglertackle) has failed to load correctly
 *     java.lang.RuntimeException: Attempted to load class net/minecraft/client/gui/screens/Screen
 *     for invalid dist DEDICATED_SERVER
 * </pre>
 * 也就是**整个模组装不进专用服务器**（单人游戏看不出来 —— 客户端和服务端在同一个进程里）。
 * 触发点是对客户端类型做 {@code instanceof}（子类型检查必须把类加载进来）。
 *
 * <h2>做法</h2>
 * common 侧只注册 C→S 的包；S→C 的包**注册与处理都放在这个 {@code Dist.CLIENT} 类里**
 * （{@code RegisterPayloadHandlersEvent} 在两侧都会触发，各注册自己那半边即可，
 * 版本号仍然是同一个 "1"）。这样 {@code ModNetwork} 的常量池里再没有任何客户端类型。
 */
@EventBusSubscriber(modid = AnglersTackle.MOD_ID, value = Dist.CLIENT)
public final class ClientPayloadHandlers {

    private ClientPayloadHandlers() {
    }

    /** 客户端侧注册：所有 S→C 的包。 */
    @SubscribeEvent
    public static void registerClientPayloads(RegisterPayloadHandlersEvent event) {
        var registrar = event.registrar("1");
        registrar.playToClient(SessionSyncPayload.TYPE, SessionSyncPayload.STREAM_CODEC,
                ClientPayloadHandlers::handleSync);
        registrar.playToClient(RodModPayload.TYPE, RodModPayload.STREAM_CODEC,
                ClientPayloadHandlers::handleRodModOpen);
        registrar.playToClient(GuidePayload.TYPE, GuidePayload.STREAM_CODEC,
                ClientPayloadHandlers::handleGuideOpen);
        // 鱼币余额：只推一个数字，不推整份附件（附件里还有整本图鉴）
        registrar.playToClient(CoinsPayload.TYPE, CoinsPayload.STREAM_CODEC,
                ClientPayloadHandlers::handleCoins);
        // 联赛积分：同样是"只推一个数字"的小包（`docs/39`）—— HUD 与商店标题都靠它
        registrar.playToClient(LeaguePointsPayload.TYPE, LeaguePointsPayload.STREAM_CODEC,
                ClientPayloadHandlers::handleLeaguePoints);
        // 图鉴：只在这个玩家主动打开图鉴时下发一整份，不做常驻同步
        registrar.playToClient(CodexPayload.TYPE, CodexPayload.STREAM_CODEC,
                ClientPayloadHandlers::handleCodex);
        // 商店状态（等级 / 是否开店 / 售罄倒计时）
        registrar.playToClient(ShopSyncPayload.TYPE, ShopSyncPayload.STREAM_CODEC,
                ClientPayloadHandlers::handleShopSync);
        // 称号名牌：全服在线玩家的「已佩戴称号」整表（`docs/38` §2.1）——
        // 客户端只拿它给头顶名牌加后缀，没有任何回写路径
        registrar.playToClient(TitleNameplatePayload.TYPE, TitleNameplatePayload.STREAM_CODEC,
                ClientPayloadHandlers::handleNameplates);
        // 【明目】要指的那块矿（只有目标变化/心跳时才发，不是每 tick）
        registrar.playToClient(com.whitecobalt.anglertackle.network.RankPayload.TYPE, com.whitecobalt.anglertackle.network.RankPayload.STREAM_CODEC,
                com.whitecobalt.anglertackle.client.screen.LeaderboardScreen::handle);
        registrar.playToClient(OreSightPayload.TYPE, OreSightPayload.STREAM_CODEC,
                ClientPayloadHandlers::handleOreSight);
        // 菜谱：内容全是静态表（做法/允许的鱼/效果/饱食度都在客户端算），
        // 所以这个包只是"服务端允许你打开界面"——开界面必须留在客户端专用类里
        registrar.playToClient(CookbookPayload.TYPE, CookbookPayload.STREAM_CODEC,
                ClientPayloadHandlers::handleCookbook);
        // 邮箱：服务端推一份快照，客户端缓存后开界面（已经开着就地刷新 —— 领完奖不要闪一下）
        registrar.playToClient(com.whitecobalt.anglertackle.network.MailPayload.TYPE,
                com.whitecobalt.anglertackle.network.MailPayload.STREAM_CODEC,
                ClientPayloadHandlers::handleMails);
        // 称号：同样先落缓存再开界面（已经开着就就地刷新 —— 戴上之后不要闪一下）
        registrar.playToClient(com.whitecobalt.anglertackle.network.TitlePayload.TYPE,
                com.whitecobalt.anglertackle.network.TitlePayload.STREAM_CODEC,
                ClientPayloadHandlers::handleTitles);
        // 委托面板（`docs/40` §9）：先落缓存再开界面（已经开着就地刷新 —— 接完委托不要闪一下）
        registrar.playToClient(com.whitecobalt.anglertackle.network.QuestPayload.TYPE,
                com.whitecobalt.anglertackle.network.QuestPayload.STREAM_CODEC,
                ClientPayloadHandlers::handleQuests);
        // 成就面板（docs/41 §7 A4，2026-10-15）：同样"先落缓存再开界面 / 已经开着就地刷新"。
        // 处理器写成内联 lambda 而不是再开一个静态方法 —— 它只此一处用，少一个方法少一处接线。
        // 垂纶终端（统合界面，2026-10-15）：一次性界面，不需要缓存 —— 收到就开 / 已开着就留着。
        registrar.playToClient(com.whitecobalt.anglertackle.network.TerminalPayload.TYPE,
                com.whitecobalt.anglertackle.network.TerminalPayload.STREAM_CODEC,
                (payload, context) -> context.enqueueWork(() -> {
                    Minecraft mc = Minecraft.getInstance();
                    if (!(mc.screen instanceof com.whitecobalt.anglertackle.client.screen.TerminalScreen)) {
                        mc.setScreen(new com.whitecobalt.anglertackle.client.screen.TerminalScreen());
                    }
                }));
        registrar.playToClient(com.whitecobalt.anglertackle.network.AchievementPayload.TYPE,
                com.whitecobalt.anglertackle.network.AchievementPayload.STREAM_CODEC,
                (payload, context) -> context.enqueueWork(() -> {
                    com.whitecobalt.anglertackle.client.ClientAchievements.accept(payload);
                    Minecraft mc = Minecraft.getInstance();
                    if (mc.screen instanceof com.whitecobalt.anglertackle.client.screen.AchievementScreen as) {
                        as.refresh();
                    } else {
                        mc.setScreen(new com.whitecobalt.anglertackle.client.screen.AchievementScreen());
                    }
                }));
    }

    /**
     * 委托面板快照（`docs/40` §9）：收下 → 缓存 → 开界面 / 就地刷新。
     *
     * <p>⚠ 包里的 {@code lastError} 是**结果码**（`""` = 成功），界面负责翻成人话 ——
     * 与邮箱 / 称号同一条做法（服务端不拼中文）。
     */
    private static void handleQuests(com.whitecobalt.anglertackle.network.QuestPayload payload,
                                     IPayloadContext context) {
        context.enqueueWork(() -> {
            com.whitecobalt.anglertackle.client.ClientQuests.accept(payload);
            Minecraft mc = Minecraft.getInstance();
            if (mc.screen instanceof com.whitecobalt.anglertackle.client.screen.QuestScreen qs) {
                qs.refresh();                 // 已经开着 ⇒ 就地刷新（不要闪一下）
            } else {
                mc.setScreen(new com.whitecobalt.anglertackle.client.screen.QuestScreen());
            }
        });
    }

    /**
     * 称号全表快照（用户 2026-10-12："称号佩戴在哪，很难发现。"）。
     *
     * <p>与邮箱同一条做法：收下 → 缓存 → 开界面 / 就地刷新。
     * 名字与条件的**中文由语言文件展开**，服务端只给 id 与状态位 ✓。
     */
    private static void handleTitles(com.whitecobalt.anglertackle.network.TitlePayload payload,
                                     IPayloadContext context) {
        context.enqueueWork(() -> {
            com.whitecobalt.anglertackle.client.ClientTitles.accept(payload);
            Minecraft mc = Minecraft.getInstance();
            if (mc.screen instanceof com.whitecobalt.anglertackle.client.screen.TitleScreen ts) {
                ts.refresh();                 // 已经开着 ⇒ 就地刷新（佩戴完不要闪一下）
            } else {
                mc.setScreen(new com.whitecobalt.anglertackle.client.screen.TitleScreen());
            }
        });
    }

    /**
     * 邮箱快照（`docs/36` §5）：收下 → 缓存 → 开界面 / 就地刷新。
     *
     * <p>⚠ 只把 {@code template + args} 交给界面，**中文由语言文件展开** ——
     * 服务端从头到尾没拼过一个中文（那条纪律的落点就在这类 handler 上）。
     */
    private static void handleMails(com.whitecobalt.anglertackle.network.MailPayload payload,
                                    IPayloadContext context) {
        context.enqueueWork(() -> {
            com.whitecobalt.anglertackle.client.ClientMails.accept(payload);
            Minecraft mc = Minecraft.getInstance();
            if (mc.screen instanceof com.whitecobalt.anglertackle.client.screen.MailScreen ms) {
                ms.refresh();                 // 已经开着 ⇒ 就地刷新（领完奖不要闪一下）
            } else if (payload.autoOpen()) {
                mc.setScreen(new com.whitecobalt.anglertackle.client.screen.MailScreen());
            }
            // ⚠ autoOpen = false（**后台到了一封信**）⇒ 只更新缓存，绝不替玩家开窗：
            //   玩家可能正在钓鱼/打怪，弹一个邮箱上来是打扰。他下一帧打开邮箱就是最新的一份 ✓。
        });
    }

    private static void handleCookbook(CookbookPayload payload, IPayloadContext context) {
        context.enqueueWork(() -> {
            Minecraft mc = Minecraft.getInstance();
            if (!(mc.screen instanceof CookbookScreen)) {
                mc.setScreen(new CookbookScreen());
            }
        });
    }

    private static void handleOreSight(OreSightPayload payload, IPayloadContext context) {
        context.enqueueWork(() -> ClientOreSight.accept(payload));
    }

    // =================================================================== S→C
    private static void handleSync(SessionSyncPayload payload, IPayloadContext context) {
        context.enqueueWork(() -> ClientFishingState.get().accept(payload));
    }

    private static void handleCodex(CodexPayload payload, IPayloadContext context) {
        context.enqueueWork(() -> {
            // 先落缓存再开界面：界面读的就是这份缓存，顺序反了会先画一帧"读取中"。
            ClientCodex.accept(payload);
            Minecraft mc = Minecraft.getInstance();
            if (mc.screen instanceof CodexScreen existing) {
                // 已经开着图鉴：原地刷新数据，不重新开窗
                //（重开会闪一下，而且把页码和鼠标位置一起丢掉）。
                existing.acceptNewData(payload);
            } else {
                mc.setScreen(new CodexScreen(payload));
            }
        });
    }

    private static void handleShopSync(ShopSyncPayload payload, IPayloadContext context) {
        context.enqueueWork(() -> {
            ClientShopState.accept(payload);
            // 先落缓存再开界面 —— 反了会先画一帧"全未解锁"再跳一下。
            Minecraft mc = Minecraft.getInstance();
            if (!(mc.screen instanceof ShopScreen)) {
                mc.setScreen(new ShopScreen());
            }
        });
    }

    private static void handleCoins(CoinsPayload payload, IPayloadContext context) {
        // S→C 一律 enqueueWork 再碰客户端对象 —— 网络线程上直接改客户端状态
        // 会在某些时序下抛 ConcurrentModification，且只在多人下偶发。
        context.enqueueWork(() -> ClientCoins.accept(payload.coins()));
    }

    private static void handleLeaguePoints(LeaguePointsPayload payload, IPayloadContext context) {
        // 与 handleCoins 同理：网络线程上不许碰客户端状态
        context.enqueueWork(() -> ClientLeaguePoints.accept(payload.points()));
    }

    private static void handleNameplates(TitleNameplatePayload payload, IPayloadContext context) {
        // 同上：这张表会被**渲染线程**每帧读，必须在客户端线程上换（否则可能读到换到一半的表）
        context.enqueueWork(() -> ClientNameplates.accept(payload));
    }

    private static void handleRodModOpen(RodModPayload payload, IPayloadContext context) {
        context.enqueueWork(() -> {
            Minecraft mc = Minecraft.getInstance();
            if (mc.screen instanceof RodModScreen existing) {
                // 已经开着改装界面：直接刷新数据，不重新开窗
                existing.acceptNewData(payload);
            } else {
                // 记一条日志：这样"界面到底有没有打开"从日志就能确认，
                // 不用再靠猜（之前服务端发了数据、界面没出现，查了很久）。
                com.whitecobalt.anglertackle.fishing.FishingManager.LOGGER.info(
                        "[垂纶/界面] 收到改装数据，打开界面：竿={}，槽位={}",
                        payload.rodName(), payload.slotData().size());
                mc.setScreen(new RodModScreen(payload));
                // 聊天栏也给一条反馈：万一界面被别的模组抢掉了，
                // 玩家至少知道"操作生效了"，而不是以为按键没反应。
                if (mc.player != null) {
                    mc.player.sendSystemMessage(
                            Component.translatable("message.anglertackle.rod_mod_opened",
                                    payload.rodName()));
                }
            }
        });
    }

    private static void handleGuideOpen(GuidePayload payload, IPayloadContext context) {
        context.enqueueWork(() -> {
            Minecraft mc = Minecraft.getInstance();
            if (mc.screen instanceof GuideScreen existing) {
                existing.acceptNewChapter(payload);
            } else {
                mc.setScreen(new GuideScreen(payload));
            }
        });
    }
}
