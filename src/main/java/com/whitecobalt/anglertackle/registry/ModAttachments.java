package com.whitecobalt.anglertackle.registry;

import com.whitecobalt.anglertackle.AnglersTackle;
import com.whitecobalt.anglertackle.player.AchievementData;
import com.whitecobalt.anglertackle.player.FishermanProgress;
import com.whitecobalt.anglertackle.player.MailBox;
import com.whitecobalt.anglertackle.player.PlayerFishingData;
import com.whitecobalt.anglertackle.player.PlayerTitles;
import com.whitecobalt.anglertackle.player.QuestData;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.neoforge.attachment.AttachmentType;
import net.neoforged.neoforge.registries.DeferredHolder;
import net.neoforged.neoforge.registries.DeferredRegister;
import net.neoforged.neoforge.registries.NeoForgeRegistries;

/**
 * 玩家附件类型注册。
 *
 * <p>鱼币与图鉴挂在玩家身上（{@link PlayerFishingData}），**不做成物品** ——
 * 理由见那个类的注释。
 *
 * <h2>三条设置各是干什么的</h2>
 * <ul>
 *   <li>{@code builder(...)} 里的默认值供应器：新玩家还没有这份数据时取它。
 *       返回 {@code EMPTY}（0 币、空图鉴），保证任何取值点都不会拿到 null。</li>
 *   <li>{@code serialize(CODEC)}：**持久化**。没有它，数据只活在内存里，
 *       一退出游戏就没了 —— 而"钱加了但重启就没了"这种 bug 极难被发现，
 *       因为当下看起来完全正常。</li>
 *   <li>{@code copyOnDeath()}：玩家死亡后数据保留。不做的话死一次鱼币和图鉴
 *       全部清零 —— 图鉴清零尤其恶劣，那是长期收集成果。</li>
 * </ul>
 *
 * <p>⚠ 不注册 {@code sync(...)}：鱼币和图鉴都是**服务端权威**数据，
 * 客户端要用时由服务端按需下发（图鉴走 CodexPayload，鱼币走 HUD 同步包），
 * 不用附件自带的自动同步 —— 那样会把 21 条鱼的完整记录每 tick 推给客户端。
 *
 * <h2>作用域：每个存档各自一份</h2>
 * 附件写进宿主自己的 NBT（{@code neoforge:attachments}），玩家 NBT 落在
 * {@code <存档>/playerdata/<uuid>.dat}。所以**换存档就是另一份鱼币**，
 * 这正是用户要的"存档切割"。详见 {@link PlayerFishingData} 的类注释，
 * 那里也写了为什么不该改成 Level 附件或全局 SavedData。
 */
public final class ModAttachments {

    private ModAttachments() {
    }

    public static final DeferredRegister<AttachmentType<?>> ATTACHMENT_TYPES =
            DeferredRegister.create(NeoForgeRegistries.Keys.ATTACHMENT_TYPES, AnglersTackle.MOD_ID);

    /** 玩家的鱼币 + 图鉴 + 已领里程碑。 */
    public static final DeferredHolder<AttachmentType<?>, AttachmentType<PlayerFishingData>> PLAYER_DATA =
            ATTACHMENT_TYPES.register("player_data", () -> AttachmentType
                    .builder(() -> PlayerFishingData.EMPTY)
                    .serialize(PlayerFishingData.CODEC)
                    .copyOnDeath()
                    .build());

    /**
     * 老柯那边的进度：等级、有没有说过第一句话、限购库存。
     *
     * <p>**故意没有 {@code .sync()}**：这份数据只在服务端判定"能不能买"时用，
     * 客户端需要的那点信息（等级、售罄倒计时）由商店界面打开时的包带过去。
     * 挂上 sync 会让它每 tick 往客户端推一份，没有任何用处。
     *
     * <p>{@code copyOnDeath()} 是必须的 —— 不然玩家死一次，等级评定就全没了，
     * 而那是要交付红品质鱼的，丢了等于白钓。
     */
    public static final DeferredHolder<AttachmentType<?>, AttachmentType<FishermanProgress>> FISHERMAN =
            ATTACHMENT_TYPES.register("fisherman", () -> AttachmentType
                    .builder(() -> FishermanProgress.EMPTY)
                    .serialize(FishermanProgress.CODEC)
                    .copyOnDeath()
                    .build());

    /**
     * **称号**（用户 2026-10-11："开发称号系统"）—— 已获得的称号、次数、当前佩戴、算不出来的进度。
     *
     * <p>为什么单开一个附件、而不塞进 {@link PlayerFishingData}：理由与 {@link FishermanProgress}
     * 那一段一样（那个 record 的构造点太多），细节写在 {@code PlayerTitles} 的类注释里。
     *
     * <p>{@code copyOnDeath()} 必须有 —— 称号是"永久拥有"的（用户口径 + "绝不动玩家永久数据"），
     * 死一次掉光就成了笑话 ✗。
     */
    public static final DeferredHolder<AttachmentType<?>, AttachmentType<PlayerTitles>> PLAYER_TITLES =
            ATTACHMENT_TYPES.register("player_titles", () -> AttachmentType
                    .builder(() -> PlayerTitles.EMPTY)
                    .serialize(PlayerTitles.CODEC)
                    .copyOnDeath()
                    .build());

    /**
     * **邮箱**（用户 2026-10-11 点名要的邮件系统；策划 `docs/36` M1）。
     *
     * <p>为什么单开一个附件：与 {@link PlayerTitles} 同一段理由（`PlayerFishingData` 的构造点太多，
     * 而邮件是**不断增删的表**）。老存档没有这个键 ⇒ 读进来是 {@link MailBox#EMPTY}（**零迁移** ✓）。
     *
     * <p>{@code copyOnDeath()} 必须有 —— 邮箱里可能正躺着没领的奖励，死一次清空等于把玩家的东西弄丢 ✗。
     */
    public static final DeferredHolder<AttachmentType<?>, AttachmentType<MailBox>> PLAYER_MAILS =
            ATTACHMENT_TYPES.register("player_mails", () -> AttachmentType
                    .builder(() -> MailBox.EMPTY)
                    .serialize(MailBox.CODEC)
                    .copyOnDeath()
                    .build());

    /**
     * **委托**（老柯的每日 / 周常任务；用户 2026-10-14 定案，策划 `docs/40`）。
     *
     * <p>为什么单开一个附件：与 {@link MailBox} 同一段理由（`PlayerFishingData` 的构造点太多，
     * 而委托是**会不断增删的表**）。老存档没有这个键 ⇒ 读进来是 {@link QuestData#EMPTY}（**零迁移** ✓）——
     * 空数据意味着 {@code lastDailyDay = 0}，登录当天就会补发当天的委托（用户要的行为）✓。
     *
     * <p>{@code copyOnDeath()} 必须有 —— 委托进度里有"累计完成数"这种长期统计，
     * 死一次清零等于把玩家的努力抹掉 ✗。
     */
    public static final DeferredHolder<AttachmentType<?>, AttachmentType<QuestData>> PLAYER_QUESTS =
            ATTACHMENT_TYPES.register("player_quests", () -> AttachmentType
                    .builder(() -> QuestData.EMPTY)
                    .serialize(QuestData.CODEC)
                    .copyOnDeath()
                    .build());

    /**
     * **成就**（策划 `docs/41` §7 阶段 A1；用户 2026-10-15 选定实现路线 C 混合）。
     *
     * <p>为什么单开一个附件：与 {@link PlayerTitles} 那一段同一理由（`PlayerFishingData`
     * 的构造点太多）。老存档没有这个键 ⇒ 读进来是 {@link AchievementData#EMPTY}（**零迁移** ✓）。
     *
     * <p>{@code copyOnDeath()} 必须有 —— 成就是"一次性里程碑、永久点亮"，
     * 死一次掉光等于把玩家的长期成果抹掉 ✗。
     */
    public static final DeferredHolder<AttachmentType<?>, AttachmentType<AchievementData>> PLAYER_ACHIEVEMENTS =
            ATTACHMENT_TYPES.register("player_achievements", () -> AttachmentType
                    .builder(() -> AchievementData.EMPTY)
                    .serialize(AchievementData.CODEC)
                    .copyOnDeath()
                    .build());

    public static void register(IEventBus modBus) {
        ATTACHMENT_TYPES.register(modBus);
    }}
