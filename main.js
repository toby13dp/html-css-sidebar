/* main.js – HTML–CSS Sidebar met filter, groepering en diff-highlight */
/*global define, brackets, $ */

define(function (require, exports, module) {
    "use strict";

    var AppInit          = brackets.getModule("utils/AppInit"),
        EditorManager    = brackets.getModule("editor/EditorManager"),
        DocumentManager  = brackets.getModule("document/DocumentManager"),
        HTMLUtils        = brackets.getModule("language/HTMLUtils"),
        CSSUtils         = brackets.getModule("language/CSSUtils"),
        Resizer          = brackets.getModule("utils/Resizer"),
        ExtensionUtils   = brackets.getModule("utils/ExtensionUtils"),
        CommandManager   = brackets.getModule("command/CommandManager"),
        Commands         = brackets.getModule("command/Commands"),
        Menus            = brackets.getModule("command/Menus");

    var PANEL_ID   = "html-css-sidebar-panel";
    var CMD_TOGGLE = "toby.htmlCssSidebar.toggle";

    var $panel            = null;
    var $panelBody        = null;
    var $panelTitle       = null;
    var $fileFilterSelect = null;
    var $countLabel       = null;
    var $groupsContainer  = null;

    var currentEditor   = null;
    var currentSelector = null;
    var refreshTimer    = null;
    var isSearching     = false;

    var lastRules       = [];
    var lastGroups      = [];
    var activeFileFilter = "*";

    /* ---------- helpers ---------- */

    function _loadStyles() {
        ExtensionUtils.loadStyleSheet(module, "styles.css");
    }

    function _isHtmlLikeDocument(doc) {
        if (!doc) {
            return false;
        }
        var langId = doc.getLanguage().getId();
        return /html|php|php-html|handlebars|mustache|ejs|vue|svelte|htm/i.test(langId);
    }

    function _createPanelIfNeeded() {
        if ($panel && $panel.length) {
            return;
        }

        var panelHtml =
            '<div id="' + PANEL_ID + '" class="html-css-sidebar sidebar horz-resizable left-resizer">' +
                '<div class="resizable-content html-css-sidebar-inner">' +
                    '<div class="html-css-sidebar-header">' +
                        '<span class="html-css-sidebar-title">CSS voor selectie</span>' +
                        '<button class="html-css-sidebar-close" title="Sluiten">&times;</button>' +
                    '</div>' +
                    '<div class="html-css-sidebar-body">' +
                        '<div class="html-css-sidebar-empty">' +
                            'Plaats de cursor op een tag, class of id in een HTML-bestand.' +
                        '</div>' +
                    '</div>' +
                '</div>' +
            '</div>';

        var $mainView = $(".main-view");
        if (!$mainView.length) {
            console.error("[html-css-sidebar] .main-view niet gevonden.");
            $panel = null;
            return;
        }

        $panel = $(panelHtml).appendTo($mainView);
        $panelBody  = $panel.find(".html-css-sidebar-body");
        $panelTitle = $panel.find(".html-css-sidebar-title");

        $panel.find(".html-css-sidebar-close").on("click.htmlCssSidebar", function () {
            _hidePanel();
        });

        Resizer.makeResizable(
            $panel[0],
            "horz",
            "left",
            260,
            true
        );

        $panel.on(
            "panelResizeUpdate.htmlCssSidebar panelExpanded.htmlCssSidebar panelCollapsed.htmlCssSidebar",
            function () {
                _syncEditorLayoutWithPanel();
            }
        );

        Resizer.hide($panel[0]);
        _syncEditorLayoutWithPanel();
    }

    function _syncEditorLayoutWithPanel() {
        var $content = $(".main-view .content");
        if (!$content.length || !$panel || !$panel.length) {
            return;
        }

        if (Resizer.isVisible($panel[0])) {
            var width = $panel.outerWidth();
            $content.css("right", width + "px");
        } else {
            $content.css("right", "");
        }
    }

    function _showPanel() {
        _createPanelIfNeeded();
        if (!$panel || !$panel.length) {
            return;
        }
        if (!Resizer.isVisible($panel[0])) {
            Resizer.show($panel[0]);
        }
        _syncEditorLayoutWithPanel();
        _refreshForCurrentEditor(true);
    }

    function _hidePanel() {
        if (!$panel || !$panel.length) {
            return;
        }
        if (Resizer.isVisible($panel[0])) {
            Resizer.hide($panel[0]);
        }
        _syncEditorLayoutWithPanel();
    }

    function _togglePanel() {
        _createPanelIfNeeded();
        if (!$panel || !$panel.length) {
            return;
        }
        if (Resizer.isVisible($panel[0])) {
            _hidePanel();
        } else {
            _showPanel();
        }
    }

    function _getSimpleSelectorFromCursor(editor) {
        if (!editor) {
            return null;
        }

        var pos = editor.getCursorPos();
        var tagInfo;

        try {
            tagInfo = HTMLUtils.getTagInfo(editor, pos);
        } catch (e) {
            console.error("[html-css-sidebar] HTMLUtils.getTagInfo() faalde", e);
            return null;
        }

        if (!tagInfo || !tagInfo.tagName) {
            return null;
        }

        var selector = null;
        var tagName  = String(tagInfo.tagName).toLowerCase();
        var attr     = tagInfo.attr || null;
        var position = tagInfo.position || {};

        if (attr && attr.name && attr.value != null) {
            var attrName   = String(attr.name).toLowerCase();
            var rawValue   = String(attr.value);
            var cleanValue = rawValue.replace(/^['"]|['"]$/g, "").trim();
            var classes;

            if (attrName === "id" && cleanValue) {
                selector = "#" + cleanValue;
            } else if (attrName === "class" && cleanValue) {
                classes = cleanValue.split(/\s+/).filter(Boolean);
                var offset = (typeof position.offset === "number") ? position.offset : null;
                var chosen = null;

                if (offset != null && offset >= 0 && offset <= cleanValue.length && classes.length) {
                    var before = cleanValue.slice(0, offset);
                    var tokens = before.split(/\s+/).filter(Boolean);
                    chosen = tokens.length ? tokens[tokens.length - 1] : classes[0];
                } else if (classes.length) {
                    chosen = classes[0];
                }

                if (chosen) {
                    selector = "." + chosen;
                }
            }
        }

        if (!selector && tagName) {
            selector = tagName;
        }

        return selector || null;
    }

    function _renderEmptyState() {
        if (!$panelBody) {
            return;
        }
        $panelBody
            .empty()
            .append(
                $("<div class='html-css-sidebar-empty'>")
                    .text("Plaats de cursor op een tag, class of id in een HTML-bestand.")
            );
        if ($panelTitle) {
            $panelTitle.text("CSS voor selectie");
        }
        lastRules = [];
        lastGroups = [];
    }

    function _renderNoRules(selectorName) {
        if (!$panelBody) {
            return;
        }
        $panelBody
            .empty()
            .append(
                $("<div class='html-css-sidebar-empty'>")
                    .text("Geen CSS-regels gevonden voor \"" + selectorName + "\".")
            );
        if ($panelTitle) {
            $panelTitle.text("CSS voor " + selectorName);
        }
        lastRules = [];
        lastGroups = [];
    }

    function _jumpToRule(ctx) {
        if (!ctx || !ctx.document) {
            return;
        }

        var doc       = ctx.document;
        var file      = doc.file;
        var targetPath = file && file.fullPath;

        function _focusInEditor(editor) {
            if (!editor) {
                return;
            }
            var line = ctx.from.line;
            editor.setSelection({ line: line, ch: 0 }, { line: line, ch: 0 }, true);
            editor.centerOnCursor();
        }

        if (targetPath) {
            CommandManager.execute(Commands.FILE_OPEN, { fullPath: targetPath })
                .done(function () {
                    var editor = EditorManager.getCurrentFullEditor();
                    _focusInEditor(editor);
                });
        } else {
            var editor = EditorManager.getCurrentFullEditor();
            _focusInEditor(editor);
        }
    }

    function _onRuleInput() {
        var $this = $(this);
        var ctx   = $this.data("ruleCtx");
        if (!ctx || !ctx.$item) {
            return;
        }
        if ($this.val() !== ctx.originalText) {
            ctx.$item.addClass("html-css-sidebar-item-changed");
        } else {
            ctx.$item.removeClass("html-css-sidebar-item-changed html-css-sidebar-item-saved");
        }
    }

    function _onRuleBlur() {
        var $this = $(this);
        var ctx   = $this.data("ruleCtx");

        if (!ctx || !ctx.document) {
            return;
        }

        var doc       = ctx.document;
        var newText   = $this.val();
        var current   = doc.getRange(ctx.from, ctx.to);

        if (newText === current) {
            return;
        }

        doc.replaceRange(newText, ctx.from, ctx.to);

        ctx.originalText = newText;

        if (ctx.$item) {
            ctx.$item
                .removeClass("html-css-sidebar-item-changed")
                .addClass("html-css-sidebar-item-saved");

            window.setTimeout(function () {
                if (ctx.$item) {
                    ctx.$item.removeClass("html-css-sidebar-item-saved");
                }
            }, 600);
        }
    }

    function _dedupeRules(rules) {
        var out  = [];
        var seen = Object.create(null);

        (rules || []).forEach(function (rule) {
            if (!rule || !rule.document) {
                return;
            }
            var doc  = rule.document;
            var file = doc.file;
            var fp   = file ? file.fullPath : "[inline]:" + (doc.__id || doc._id || "");
            var key  = fp + ":" + rule.lineStart + ":" + rule.lineEnd + ":" + (rule.name || "");
            if (!seen[key]) {
                seen[key] = true;
                out.push(rule);
            }
        });

        return out;
    }

    function _groupRulesByFile(rules) {
        var groupsByKey = Object.create(null);

        (rules || []).forEach(function (rule) {
            if (!rule || !rule.document) {
                return;
            }
            var doc  = rule.document;
            var file = doc.file;

            var filePath = file ? file.fullPath : "[inline]:" + (doc.__id || doc._id || "");
            var fileName = file ? file.name : "[inline <style>]";

            if (!groupsByKey[filePath]) {
                groupsByKey[filePath] = {
                    filePath: filePath,
                    fileName: fileName,
                    rules: []
                };
            }
            groupsByKey[filePath].rules.push(rule);
        });

        var keys   = Object.keys(groupsByKey).sort();
        var groups = keys.map(function (k) { return groupsByKey[k]; });

        groups.forEach(function (g) {
            g.rules.sort(function (a, b) {
                return a.lineStart - b.lineStart;
            });
        });

        return groups;
    }

    function _renderRuleGroups(groups) {
        if (!$groupsContainer) {
            return;
        }

        $groupsContainer.empty();

        var totalRules  = 0;
        var totalFiles  = groups.length;
        var shownRules  = 0;
        var shownFiles  = 0;

        groups.forEach(function (g) {
            totalRules += g.rules.length;
        });

        groups.forEach(function (group) {
            if (activeFileFilter !== "*" && group.filePath !== activeFileFilter) {
                return;
            }

            shownFiles++;
            shownRules += group.rules.length;

            var $group      = $("<div class='html-css-sidebar-group'>");
            var $groupHead  = $("<div class='html-css-sidebar-group-header'>");
            var $groupTitle = $("<span class='html-css-sidebar-group-title'>")
                .text(group.fileName);
            var $groupBadge = $("<span class='html-css-sidebar-group-badge'>")
                .text(group.rules.length + " regel" + (group.rules.length === 1 ? "" : "s"));

            $groupHead.append($groupTitle).append($groupBadge);

            var $groupBody = $("<div class='html-css-sidebar-group-body'>");

            group.rules.forEach(function (rule) {
                var doc = rule.document;
                if (!doc) {
                    return;
                }

                var from = { line: rule.lineStart, ch: 0 };
                var to   = { line: rule.lineEnd + 1, ch: 0 };
                var txt  = doc.getRange(from, to);
                var file = doc.file;
                var fileName = file ? file.name : "[inline <style>]";

                var $item  = $("<div class='html-css-sidebar-item'>");
                var $meta  = $("<div class='html-css-sidebar-meta'>");
                var label  = (rule.name || "(selector)") + " — " +
                             fileName + " : " + (rule.lineStart + 1);
                $meta.text(label);

                var $textarea = $("<textarea class='html-css-sidebar-textarea' spellcheck='false'>")
                    .val(txt);

                var ctx = {
                    document     : doc,
                    from         : from,
                    to           : to,
                    rule         : rule,
                    selectorName : currentSelector,
                    filePath     : group.filePath,
                    originalText : txt,
                    $item        : $item
                };

                $textarea.data("ruleCtx", ctx);

                $meta.on("click.htmlCssSidebar", function () {
                    _jumpToRule(ctx);
                });

                $textarea
                    .on("input.htmlCssSidebar", _onRuleInput)
                    .on("blur.htmlCssSidebar", _onRuleBlur);

                $item.append($meta).append($textarea);
                $groupBody.append($item);
            });

            $groupHead.on("click.htmlCssSidebar", function () {
                $group.toggleClass("collapsed");
            });

            $group.append($groupHead).append($groupBody);
            $groupsContainer.append($group);
        });

        if ($countLabel) {
            var labelText;
            if (activeFileFilter === "*") {
                labelText = totalRules + " regel" + (totalRules === 1 ? "" : "s") +
                            " in " + totalFiles + " bestand" + (totalFiles === 1 ? "" : "en");
            } else {
                labelText = shownRules + " regel" + (shownRules === 1 ? "" : "s") +
                            " in " + shownFiles + " bestand" + (shownFiles === 1 ? "" : "en");
            }
            $countLabel.text(labelText);
        }
    }

    function _renderRules(selectorName, rules) {
        if (!$panelBody) {
            return;
        }

        lastRules  = _dedupeRules(rules || []);
        lastGroups = _groupRulesByFile(lastRules);

        $panelBody.empty();

        if (!lastRules.length) {
            _renderNoRules(selectorName);
            return;
        }

        if ($panelTitle) {
            $panelTitle.text("CSS voor " + selectorName);
        }

        var $filterBar = $("<div class='html-css-sidebar-filterbar'>");
        var $label     = $("<label class='html-css-sidebar-filterlabel'>").text("Bestand:");
        $fileFilterSelect = $("<select id='html-css-sidebar-filefilter'>");
        $countLabel       = $("<span class='html-css-sidebar-count'>");

        $fileFilterSelect.append(
            $("<option>").val("*").text("Alle bestanden")
        );

        lastGroups.forEach(function (group) {
            $fileFilterSelect.append(
                $("<option>")
                    .val(group.filePath)
                    .text(group.fileName)
            );
        });

        if (!lastGroups.some(function (g) { return g.filePath === activeFileFilter; })) {
            activeFileFilter = "*";
        }
        $fileFilterSelect.val(activeFileFilter);

        $fileFilterSelect.on("change.htmlCssSidebar", function () {
            activeFileFilter = $(this).val();
            _renderRuleGroups(lastGroups);
        });

        $filterBar
            .append($label)
            .append($fileFilterSelect)
            .append($countLabel);

        $groupsContainer = $("<div class='html-css-sidebar-groups'>");

        $panelBody
            .append($filterBar)
            .append($groupsContainer);

        _renderRuleGroups(lastGroups);
    }

    function _refreshForCurrentEditor(force) {
        if (!$panel || !$panel.length || !Resizer.isVisible($panel[0])) {
            return;
        }

        if (!currentEditor || !_isHtmlLikeDocument(currentEditor.document)) {
            _renderEmptyState();
            return;
        }

        var selectorName = _getSimpleSelectorFromCursor(currentEditor);
        if (!selectorName) {
            _renderEmptyState();
            return;
        }

        if (!force && selectorName === currentSelector && !isSearching) {
            return;
        }

        currentSelector = selectorName;
        isSearching     = true;

        CSSUtils.findMatchingRules(selectorName, currentEditor.document)
            .done(function (rules) {
                _renderRules(selectorName, rules || []);
            })
            .fail(function (err) {
                console.error("[html-css-sidebar] CSSUtils.findMatchingRules() fout", err);
                _renderNoRules(selectorName);
            })
            .always(function () {
                isSearching = false;
            });
    }

    function _scheduleRefresh() {
        if (refreshTimer) {
            window.clearTimeout(refreshTimer);
        }
        refreshTimer = window.setTimeout(function () {
            _refreshForCurrentEditor(false);
        }, 150);
    }

    function _detachFromEditor(editor) {
        if (!editor) {
            return;
        }
        editor.off(".htmlCssSidebar");
    }

    function _attachToEditor(editor) {
        currentEditor   = null;
        currentSelector = null;

        if (!editor || !_isHtmlLikeDocument(editor.document)) {
            _renderEmptyState();
            return;
        }

        currentEditor = editor;

        editor.on("cursorActivity.htmlCssSidebar", function () {
            _scheduleRefresh();
        });

        _refreshForCurrentEditor(true);
    }

    function _onActiveEditorChange(evt, newEditor, oldEditor) {
        _detachFromEditor(oldEditor);
        _attachToEditor(newEditor);
    }

    AppInit.appReady(function () {
        _loadStyles();
        _createPanelIfNeeded();

        CommandManager.register("HTML-CSS Sidebar", CMD_TOGGLE, _togglePanel);
        var viewMenu = Menus.getMenu(Menus.AppMenuBar.VIEW_MENU);
        if (viewMenu) {
            viewMenu.addMenuItem(CMD_TOGGLE);
        }

        EditorManager.on("activeEditorChange.htmlCssSidebar", _onActiveEditorChange);

        var editor = EditorManager.getCurrentFullEditor();
        if (editor) {
            _attachToEditor(editor);
        } else {
            _renderEmptyState();
        }
    });

    function _dispose() {
        EditorManager.off(".htmlCssSidebar");
        if (currentEditor) {
            _detachFromEditor(currentEditor);
            currentEditor = null;
        }
        if ($panel && $panel.length) {
            $panel.off(".htmlCssSidebar");
            $panel.remove();
            $panel = null;
        }
    }

    exports.dispose = _dispose;
});
