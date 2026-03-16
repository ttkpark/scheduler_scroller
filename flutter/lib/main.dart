import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_foreground_task/flutter_foreground_task.dart';
import 'package:webview_flutter/webview_flutter.dart';

const String kDefaultUrl =
    String.fromEnvironment('TARGET_URL', defaultValue: 'https://example.com');

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  FlutterForegroundTask.initCommunicationPort();
  runApp(const MyApp());
}

@pragma('vm:entry-point')
void startCallback() {
  FlutterForegroundTask.setTaskHandler(NotificationButtonTaskHandler());
}

class NotificationButtonTaskHandler extends TaskHandler {
  @override
  Future<void> onStart(DateTime timestamp, TaskStarter starter) async {}

  @override
  void onRepeatEvent(DateTime timestamp) {}

  @override
  Future<void> onDestroy(DateTime timestamp, bool isTimeout) async {}

  @override
  void onNotificationButtonPressed(String id) {
    FlutterForegroundTask.sendDataToMain(id);
  }
}

class MyApp extends StatelessWidget {
  const MyApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      title: 'Web Scheduler Controller',
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: Colors.indigo),
      ),
      home: const WebControllerPage(),
    );
  }
}

class WebControllerPage extends StatefulWidget {
  const WebControllerPage({super.key});

  @override
  State<WebControllerPage> createState() => _WebControllerPageState();
}

class _WebControllerPageState extends State<WebControllerPage> {
  late final TextEditingController _urlController;
  late final WebViewController _webViewController;
  bool _canGoBack = false;
  bool _canGoForward = false;

  @override
  void initState() {
    super.initState();
    _urlController = TextEditingController(text: kDefaultUrl);
    _webViewController =
        WebViewController()
          ..setJavaScriptMode(JavaScriptMode.unrestricted)
          ..setNavigationDelegate(
            NavigationDelegate(
              onPageFinished: (_) => _refreshNavigationState(),
            ),
          )
          ..loadRequest(Uri.parse(kDefaultUrl));

    FlutterForegroundTask.addTaskDataCallback(_onForegroundData);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _setupForegroundNotification();
    });
  }

  @override
  void dispose() {
    FlutterForegroundTask.removeTaskDataCallback(_onForegroundData);
    _urlController.dispose();
    super.dispose();
  }

  Future<void> _setupForegroundNotification() async {
    if (!Platform.isAndroid) {
      return;
    }

    final NotificationPermission permission =
        await FlutterForegroundTask.checkNotificationPermission();
    if (permission != NotificationPermission.granted) {
      await FlutterForegroundTask.requestNotificationPermission();
    }

    FlutterForegroundTask.init(
      androidNotificationOptions: AndroidNotificationOptions(
        channelId: 'web_controller_channel',
        channelName: '웹 컨트롤 고정 알림',
        channelDescription: '웹페이지 이전/다음 제어용 포그라운드 알림',
        channelImportance: NotificationChannelImportance.LOW,
        priority: NotificationPriority.LOW,
        onlyAlertOnce: true,
      ),
      iosNotificationOptions: const IOSNotificationOptions(
        showNotification: true,
        playSound: false,
      ),
      foregroundTaskOptions: ForegroundTaskOptions(
        eventAction: ForegroundTaskEventAction.nothing(),
        autoRunOnBoot: false,
        autoRunOnMyPackageReplaced: false,
        allowWakeLock: true,
        allowWifiLock: false,
      ),
    );

    if (await FlutterForegroundTask.isRunningService) {
      await FlutterForegroundTask.updateService(
        notificationTitle: '웹 컨트롤 활성화',
        notificationText: '알림 버튼으로 이전/다음을 이동하세요.',
        notificationButtons: const [
          NotificationButton(id: 'prev', text: '이전'),
          NotificationButton(id: 'next', text: '다음'),
        ],
      );
      return;
    }

    await FlutterForegroundTask.startService(
      serviceId: 777,
      serviceTypes: const [ForegroundServiceTypes.dataSync],
      notificationTitle: '웹 컨트롤 활성화',
      notificationText: '알림 버튼으로 이전/다음을 이동하세요.',
      notificationButtons: const [
        NotificationButton(id: 'prev', text: '이전'),
        NotificationButton(id: 'next', text: '다음'),
      ],
      callback: startCallback,
    );
  }

  Future<void> _refreshNavigationState() async {
    final bool back = await _webViewController.canGoBack();
    final bool forward = await _webViewController.canGoForward();
    if (!mounted) {
      return;
    }
    setState(() {
      _canGoBack = back;
      _canGoForward = forward;
    });
  }

  Future<void> _onForegroundData(Object data) async {
    if (data is! String) {
      return;
    }

    if (data == 'prev' && await _webViewController.canGoBack()) {
      await _webViewController.goBack();
    }
    if (data == 'next' && await _webViewController.canGoForward()) {
      await _webViewController.goForward();
    }
    await _refreshNavigationState();
  }

  Future<void> _loadEnteredUrl() async {
    final String raw = _urlController.text.trim();
    if (raw.isEmpty) {
      return;
    }

    final String normalized =
        raw.startsWith('http://') || raw.startsWith('https://')
            ? raw
            : 'https://$raw';
    final Uri? uri = Uri.tryParse(normalized);

    if (uri == null || !uri.hasAuthority) {
      if (!mounted) {
        return;
      }
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('유효한 URL을 입력해 주세요.')),
      );
      return;
    }

    await _webViewController.loadRequest(uri);
    await _refreshNavigationState();
  }

  @override
  Widget build(BuildContext context) {
    return WithForegroundTask(
      child: Scaffold(
        appBar: AppBar(title: const Text('웹 컨트롤러')),
        body: Column(
          children: [
            Padding(
              padding: const EdgeInsets.all(12),
              child: Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: _urlController,
                      decoration: const InputDecoration(
                        border: OutlineInputBorder(),
                        labelText: '웹페이지 URL',
                      ),
                      onSubmitted: (_) => _loadEnteredUrl(),
                    ),
                  ),
                  const SizedBox(width: 8),
                  FilledButton(
                    onPressed: _loadEnteredUrl,
                    child: const Text('열기'),
                  ),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12),
              child: Row(
                children: [
                  IconButton(
                    onPressed:
                        _canGoBack
                            ? () async {
                              await _webViewController.goBack();
                              await _refreshNavigationState();
                            }
                            : null,
                    icon: const Icon(Icons.arrow_back),
                    tooltip: '이전',
                  ),
                  IconButton(
                    onPressed:
                        _canGoForward
                            ? () async {
                              await _webViewController.goForward();
                              await _refreshNavigationState();
                            }
                            : null,
                    icon: const Icon(Icons.arrow_forward),
                    tooltip: '다음',
                  ),
                  IconButton(
                    onPressed:
                        () async {
                          await _webViewController.reload();
                          await _refreshNavigationState();
                        },
                    icon: const Icon(Icons.refresh),
                    tooltip: '새로고침',
                  ),
                ],
              ),
            ),
            const Divider(height: 1),
            Expanded(child: WebViewWidget(controller: _webViewController)),
          ],
        ),
      ),
    );
  }
}
