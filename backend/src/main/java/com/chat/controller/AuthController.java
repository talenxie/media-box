package com.chat.controller;

import com.chat.model.Result;
import com.chat.model.User;
import com.chat.service.UserService;
import org.springframework.web.bind.annotation.*;

import javax.annotation.Resource;
import java.util.Map;

@RestController
@RequestMapping("/api")
public class AuthController {

    @Resource
    private UserService userService;

    @PostMapping("/login")
    public Result<?> login(@RequestBody Map<String, String> body) {
        String username = body.get("username");
        String password = body.get("password");
        if (username == null || password == null) {
            return Result.error("用户名和密码不能为空");
        }
        Map<String, Object> result = userService.login(username, password);
        if (result == null) {
            return Result.error("用户名或密码错误");
        }
        return Result.ok(result);
    }

    @GetMapping("/user/info")
    public Result<?> userInfo(@RequestAttribute Long userId) {
        return Result.ok(userService.getUserByToken(null));
    }

    @GetMapping("/user/settings")
    public Result<?> getSettings(@RequestAttribute Long userId) {
        User user = userService.getUserById(userId);
        if (user == null) return Result.error("用户不存在");
        return Result.ok(user.getSettings());
    }

    @PostMapping("/user/settings")
    public Result<?> saveSettings(@RequestAttribute Long userId, @RequestBody Map<String, String> body) {
        String settings = body.get("settings");
        userService.saveSettings(userId, settings);
        return Result.ok("保存成功");
    }
}
